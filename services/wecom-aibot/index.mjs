import AiBot, { generateReqId } from '@wecom/aibot-node-sdk'
import http from 'node:http'

const required = ['AEROLOG_WECOM_BOT_ID', 'AEROLOG_WECOM_BOT_SECRET', 'AEROLOG_WECOM_BOT_INTERNAL_TOKEN', 'AEROLOG_AI_BASE_URL', 'AEROLOG_AI_API_KEY', 'AEROLOG_AI_MODEL']
const missing = required.filter((key) => !process.env[key])
if (missing.length) throw new Error(`missing config: ${missing.join(', ')}`)

const apiURL = process.env.AEROLOG_WECOM_BOT_API_URL || 'http://api:8082'
const aiBaseURL = process.env.AEROLOG_AI_BASE_URL.replace(/\/$/, '').replace(/\/v1$/, '')
const metricsPort = Number(process.env.AEROLOG_WECOM_BOT_METRICS_PORT || '9106')

const durationBuckets = [0.1, 0.25, 0.5, 1, 2, 5, 8, 15, 20, 30]
const counters = new Map()
const gauges = new Map()
const histograms = new Map()

function metricLabels(labels = {}) {
  return Object.entries(labels).filter(([, value]) => value !== undefined).sort(([left], [right]) => left.localeCompare(right))
}

function metricKey(name, labels) {
  return `${name}|${JSON.stringify(metricLabels(labels))}`
}

function formatLabels(labels = {}) {
  const pairs = metricLabels(labels)
  if (!pairs.length) return ''
  return `{${pairs.map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`).join(',')}}`
}

function increment(name, labels, value = 1) {
  const key = metricKey(name, labels)
  const item = counters.get(key) || { name, labels: metricLabels(labels), value: 0 }
  item.value += value
  counters.set(key, item)
}

function setGauge(name, labels, value) {
  gauges.set(metricKey(name, labels), { name, labels: metricLabels(labels), value })
}

function observe(name, labels, seconds) {
  const key = metricKey(name, labels)
  const item = histograms.get(key) || { name, labels: metricLabels(labels), count: 0, sum: 0, buckets: durationBuckets.map(() => 0) }
  item.count += 1
  item.sum += seconds
  durationBuckets.forEach((bucket, index) => {
    if (seconds <= bucket) item.buckets[index] += 1
  })
  histograms.set(key, item)
}

function renderMetrics() {
  const lines = [
    '# HELP aerolog_wecom_bot_requests_total 企业微信机器人处理完成的请求数',
    '# TYPE aerolog_wecom_bot_requests_total counter',
    '# HELP aerolog_wecom_bot_stage_errors_total 企业微信机器人各阶段错误数',
    '# TYPE aerolog_wecom_bot_stage_errors_total counter',
    '# HELP aerolog_wecom_bot_fallbacks_total 企业微信机器人兜底次数',
    '# TYPE aerolog_wecom_bot_fallbacks_total counter',
    '# HELP aerolog_wecom_bot_websocket_authenticated 企业微信 WebSocket 是否已认证',
    '# TYPE aerolog_wecom_bot_websocket_authenticated gauge',
    '# HELP aerolog_wecom_bot_requests_inflight 企业微信机器人处理中请求数',
    '# TYPE aerolog_wecom_bot_requests_inflight gauge',
    '# HELP aerolog_wecom_bot_stage_duration_seconds 企业微信机器人阶段耗时',
    '# TYPE aerolog_wecom_bot_stage_duration_seconds histogram',
  ]
  for (const item of counters.values()) lines.push(`${item.name}${formatLabels(Object.fromEntries(item.labels))} ${item.value}`)
  for (const item of gauges.values()) lines.push(`${item.name}${formatLabels(Object.fromEntries(item.labels))} ${item.value}`)
  for (const item of histograms.values()) {
    const labels = Object.fromEntries(item.labels)
    durationBuckets.forEach((bucket, index) => lines.push(`${item.name}_bucket${formatLabels({ ...labels, le: bucket })} ${item.buckets[index]}`))
    lines.push(`${item.name}_bucket${formatLabels({ ...labels, le: '+Inf' })} ${item.count}`)
    lines.push(`${item.name}_sum${formatLabels(labels)} ${item.sum}`)
    lines.push(`${item.name}_count${formatLabels(labels)} ${item.count}`)
  }
  return `${lines.join('\n')}\n`
}

function errorKind(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('timeout') || message.includes('aborted')) return 'timeout'
  if (message.includes('unauthorized')) return 'unauthorized'
  if (message.includes('skill')) return 'skill'
  return 'error'
}

function logEvent(event, fields = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), component: 'wecom-aibot', event, ...fields }))
}

function elapsedSeconds(startedAt) {
  return Math.max(0, (performance.now() - startedAt) / 1000)
}

function recordStage(stage, result, startedAt, extra = {}) {
  const seconds = elapsedSeconds(startedAt)
  observe('aerolog_wecom_bot_stage_duration_seconds', { stage, result }, seconds)
  return { seconds, ...extra }
}

function startMetricsServer() {
  if (!Number.isInteger(metricsPort) || metricsPort < 1 || metricsPort > 65535) throw new Error('invalid AEROLOG_WECOM_BOT_METRICS_PORT')
  const server = http.createServer((request, response) => {
    if (request.url === '/metrics') {
      response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end(renderMetrics())
      return
    }
    if (request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end('ok\n')
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('not found\n')
  })
  server.listen(metricsPort, '0.0.0.0', () => logEvent('metrics_listening', { port: metricsPort }))
}

setGauge('aerolog_wecom_bot_websocket_authenticated', {}, 0)
setGauge('aerolog_wecom_bot_requests_inflight', {}, 0)

const sdkLogger = {
  debug: () => {},
  info: () => {},
  warn: (message) => logEvent('wecom_sdk_warning', { reason: errorKind(new Error(String(message))) }),
  error: (message) => logEvent('wecom_sdk_error', { reason: errorKind(new Error(String(message))) }),
}
const bot = new AiBot.WSClient({
  botId: process.env.AEROLOG_WECOM_BOT_ID,
  secret: process.env.AEROLOG_WECOM_BOT_SECRET,
  maxReconnectAttempts: -1,
  logger: sdkLogger,
})

const skillNames = new Set(['ads_summary', 'server_status', 'kafka_status', 'disk_usage', 'directory_usage', 'directory_usage_detail'])
const timeRanges = new Set(['today', 'yesterday', 'last_hours'])

const plannerPrompt = `你是 AeroLog 只读查询规划器。根据用户问题，仅输出一个 JSON 对象，不要 Markdown、解释或 SQL。
可选 skill 仅有：ads_summary、server_status、kafka_status、disk_usage、directory_usage、directory_usage_detail。
ads_summary 用于指定项目的广告、ad_show、广告数据；params 必须包含 time_range：today、yesterday 或 last_hours。用户说“近/最近 N 小时”时，必须使用 {"time_range":"last_hours","hours":N}；未指定时间时用 today。其他 skill 的 params 必须是 {}。
server_status 用于服务器或主机资源与服务状态；kafka_status 用于 Kafka、消息队列、积压、DLQ；disk_usage 用于挂载点磁盘占用；directory_usage 用于哪些目录/文件占空间；directory_usage_detail 仅用于询问 /usr、/opt、/var/lib/docker、/var/lib/aerolog、/var/log、/var/cache、/tmp、/home 内部什么占空间。
无法匹配时输出 {"skill":"unknown","params":{}}。`

function parsePlan(content) {
  const candidate = content.match(/\{[\s\S]*\}/)?.[0]
  if (!candidate) throw new Error('AI 未返回有效查询计划')
  let plan
  try {
    plan = JSON.parse(candidate)
  } catch {
    throw new Error('AI 返回的查询计划格式无效')
  }
  const skill = plan?.skill ?? plan?.tool
  if (!skillNames.has(skill)) throw new Error('未识别可查询的 Skill')
  const params = plan?.params && typeof plan.params === 'object' && !Array.isArray(plan.params) ? plan.params : {}
  if (skill !== 'ads_summary') return { skill, params: {} }
  if (!timeRanges.has(params.time_range)) throw new Error('广告数据时间范围无效')
  if (params.time_range === 'last_hours') {
    const hours = Number(params.hours)
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('近几小时仅支持 1 到 168 小时')
    return { skill, params: { time_range: params.time_range, hours } }
  }
  return { skill, params: { time_range: params.time_range } }
}

function parseHours(value) {
  if (/^\d+$/.test(value)) return Number(value)
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  let total = 0
  let current = 0
  for (const char of value) {
    if (char === '十') {
      total += (current || 1) * 10
      current = 0
    } else if (char === '百') {
      total += (current || 1) * 100
      current = 0
    } else if (Object.hasOwn(digits, char)) {
      current = digits[char]
    } else {
      return 0
    }
  }
  return total + current
}

// fallbackPlan 在 AI 规划超时时处理已支持的固定问法，避免查询链路整体失败。
function fallbackPlan(question) {
  const lower = question.toLowerCase()
  if (/(\/usr|\/opt|\/var\/lib\/docker|\/var\/lib\/aerolog|\/var\/log|\/var\/cache|\/tmp|\/home|usr目录|opt目录|docker目录)/.test(lower)) return { skill: 'directory_usage_detail', params: {} }
  if (/目录|哪些占用|占用空间/.test(lower)) return { skill: 'directory_usage', params: {} }
  if (/磁盘|磁碟|空间占用|磁盘占用/.test(lower)) return { skill: 'disk_usage', params: {} }
  if (/kafka|消息队列|积压|dlq/.test(lower)) return { skill: 'kafka_status', params: {} }
  if (/服务器|主机|server/.test(lower)) return { skill: 'server_status', params: {} }
  if (/广告|ad_show|广告数据/.test(lower)) {
    const matched = lower.match(/(?:近|最近)\s*([0-9]+|[零一二两三四五六七八九十百]+)\s*个?小时/)
    if (matched) {
      const hours = parseHours(matched[1])
      if (Number.isInteger(hours) && hours >= 1 && hours <= 168) return { skill: 'ads_summary', params: { time_range: 'last_hours', hours } }
    }
    if (/昨天|yesterday/.test(lower)) return { skill: 'ads_summary', params: { time_range: 'yesterday' } }
    return { skill: 'ads_summary', params: { time_range: 'today' } }
  }
  throw new Error('未识别可查询的 Skill')
}

async function planSkill(question) {
  const response = await fetch(`${aiBaseURL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AEROLOG_AI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.AEROLOG_AI_MODEL,
      temperature: 0,
      max_tokens: 180,
      messages: [
        { role: 'system', content: plannerPrompt },
        { role: 'user', content: question },
      ],
    }),
    signal: AbortSignal.timeout(8000),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'AI 查询规划失败')
  return parsePlan(payload?.choices?.[0]?.message?.content?.trim() || '')
}

function fallbackSummary(data) {
  if (data?.skill === 'ads_summary') {
    const events = Array.isArray(data.events) && data.events.length
      ? data.events.map((item) => `- ${item.event}：${item.count} 次，${item.users} 去重用户`).join('\n')
      : '- 无广告事件'
    return `**${data.project_name} 广告数据**\n\n- 数据时间：${data.from} ～ ${data.to}\n- 广告事件总次数：${data.total_count}\n\n**主要事件**\n${events}`
  }
  if (data?.skill === 'directory_usage_detail') {
    const directories = Array.isArray(data.directories) && data.directories.length
      ? data.directories.map((item) => `- ${item.path}：${formatBytes(item.bytes)}${item.completed ? '' : '（扫描未完成）'}`).join('\n')
      : '- 没有可统计的一级子项'
    return `**${data.path} 目录明细**\n\n${directories}\n\n仅统计白名单目录的一级子项。`
  }
  return `查询完成，AI 整理超时。原始结果：\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1)
  return `${(value / (1024 ** (index + 1))).toFixed(value >= 1024 ** 3 ? 2 : 1)} ${units[index]}`
}

async function queryAnalytics(question, plan) {
  const response = await fetch(`${apiURL}/v1/internal/wecom-bot/analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AeroLog-Bot-Token': process.env.AEROLOG_WECOM_BOT_INTERNAL_TOKEN },
    body: JSON.stringify({ question, skill: plan.skill, params: plan.params }),
    signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.err || '数据查询失败')
  return payload.data
}

async function summarize(question, data) {
  const response = await fetch(`${aiBaseURL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.AEROLOG_AI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.AEROLOG_AI_MODEL,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: '你是 AeroLog 运维与数据助手。只能根据提供的 JSON 数据回答，不得编造数据。用简短中文 Markdown 整理结果。skill=server_status 时列 CPU、内存、磁盘、API、采集服务状态；skill=disk_usage 时按使用率降序列出挂载点；skill=directory_usage 时按 bytes 降序列出目录及大小；skill=directory_usage_detail 时按 bytes 降序列出指定目录一级子项及大小，并说明只统计白名单一级子项；skill=kafka_status 时列消费者、lag、DLQ；广告数据时列时间范围、总次数、去重用户数、主要事件。缺失或 unavailable 必须明确说明。' },
        { role: 'user', content: `问题：${question}\n\n受限查询结果：${JSON.stringify(data)}` },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'AI 请求失败')
  return payload?.choices?.[0]?.message?.content?.trim() || 'AI 未返回内容'
}

bot.on('authenticated', () => {
  setGauge('aerolog_wecom_bot_websocket_authenticated', {}, 1)
  logEvent('wecom_authenticated')
})
bot.on('disconnected', () => {
  setGauge('aerolog_wecom_bot_websocket_authenticated', {}, 0)
  logEvent('wecom_disconnected')
})
bot.on('message.text', async (frame) => {
  const content = frame.body?.text?.content?.trim()
  if (!content) return
  const messageID = typeof frame.body?.msgid === 'string' ? frame.body.msgid : 'unknown'
  const requestStartedAt = performance.now()
  const inflight = (gauges.get(metricKey('aerolog_wecom_bot_requests_inflight', {}))?.value || 0) + 1
  setGauge('aerolog_wecom_bot_requests_inflight', {}, inflight)
  logEvent('request_received', { message_id: messageID })
  const streamID = generateReqId('aerolog')
  let skill = 'unknown'
  let planFallback = false
  let summaryFallback = false
  try {
    const initialReplyStartedAt = performance.now()
    await bot.replyStream(frame, streamID, '正在理解问题并查询 AeroLog 数据…', false)
    recordStage('initial_reply', 'success', initialReplyStartedAt)
    let plan
    const planningStartedAt = performance.now()
    try {
      plan = await planSkill(content)
      recordStage('plan', 'success', planningStartedAt)
    } catch (error) {
      const reason = errorKind(error)
      recordStage('plan', 'error', planningStartedAt)
      increment('aerolog_wecom_bot_stage_errors_total', { stage: 'plan', reason })
      plan = fallbackPlan(content)
      planFallback = true
      increment('aerolog_wecom_bot_fallbacks_total', { stage: 'plan', reason })
      logEvent('plan_fallback', { message_id: messageID, reason, skill: plan.skill })
    }
    skill = plan.skill
    const queryStartedAt = performance.now()
    let data
    try {
      data = await queryAnalytics(content, plan)
      recordStage('query', 'success', queryStartedAt)
    } catch (error) {
      const reason = errorKind(error)
      recordStage('query', 'error', queryStartedAt)
      increment('aerolog_wecom_bot_stage_errors_total', { stage: 'query', reason })
      throw error
    }
    let answer
    const summaryStartedAt = performance.now()
    try {
      answer = await summarize(content, data)
      recordStage('summary', 'success', summaryStartedAt)
    } catch (error) {
      const reason = errorKind(error)
      recordStage('summary', 'error', summaryStartedAt)
      increment('aerolog_wecom_bot_stage_errors_total', { stage: 'summary', reason })
      answer = fallbackSummary(data)
      summaryFallback = true
      increment('aerolog_wecom_bot_fallbacks_total', { stage: 'summary', reason })
      logEvent('summary_fallback', { message_id: messageID, reason, skill })
    }
    const finalReplyStartedAt = performance.now()
    await bot.replyStream(frame, streamID, answer, true)
    recordStage('final_reply', 'success', finalReplyStartedAt)
    increment('aerolog_wecom_bot_requests_total', { result: 'success', skill })
    logEvent('request_completed', { message_id: messageID, skill, plan_fallback: planFallback, summary_fallback: summaryFallback, duration_ms: Math.round(elapsedSeconds(requestStartedAt) * 1000) })
  } catch (error) {
    const reason = errorKind(error)
    increment('aerolog_wecom_bot_requests_total', { result: 'error', skill })
    increment('aerolog_wecom_bot_stage_errors_total', { stage: 'request', reason })
    logEvent('request_failed', { message_id: messageID, skill, reason, duration_ms: Math.round(elapsedSeconds(requestStartedAt) * 1000) })
    try {
      const replyStartedAt = performance.now()
      await bot.replyStream(frame, streamID, `查询失败：${reason === 'timeout' ? '请求超时，请稍后重试' : '服务暂时不可用，请稍后重试'}`, true)
      recordStage('error_reply', 'success', replyStartedAt)
    } catch (replyError) {
      const replyReason = errorKind(replyError)
      increment('aerolog_wecom_bot_stage_errors_total', { stage: 'error_reply', reason: replyReason })
      logEvent('error_reply_failed', { message_id: messageID, reason: replyReason })
    }
  } finally {
    const remaining = Math.max(0, (gauges.get(metricKey('aerolog_wecom_bot_requests_inflight', {}))?.value || 1) - 1)
    setGauge('aerolog_wecom_bot_requests_inflight', {}, remaining)
  }
})
startMetricsServer()
bot.connect()

process.on('SIGTERM', () => {
  setGauge('aerolog_wecom_bot_websocket_authenticated', {}, 0)
  bot.disconnect()
  process.exit(0)
})
