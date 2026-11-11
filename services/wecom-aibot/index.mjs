import AiBot, { generateReqId } from '@wecom/aibot-node-sdk'

const required = ['AEROLOG_WECOM_BOT_ID', 'AEROLOG_WECOM_BOT_SECRET', 'AEROLOG_WECOM_BOT_INTERNAL_TOKEN', 'AEROLOG_AI_BASE_URL', 'AEROLOG_AI_API_KEY', 'AEROLOG_AI_MODEL']
const missing = required.filter((key) => !process.env[key])
if (missing.length) throw new Error(`missing config: ${missing.join(', ')}`)

const apiURL = process.env.AEROLOG_WECOM_BOT_API_URL || 'http://api:8082'
const aiBaseURL = process.env.AEROLOG_AI_BASE_URL.replace(/\/$/, '').replace(/\/v1$/, '')
const bot = new AiBot.WSClient({
  botId: process.env.AEROLOG_WECOM_BOT_ID,
  secret: process.env.AEROLOG_WECOM_BOT_SECRET,
  maxReconnectAttempts: -1,
})

const skillNames = new Set(['ads_summary', 'server_status', 'kafka_status', 'disk_usage', 'directory_usage'])
const timeRanges = new Set(['today', 'yesterday', 'last_hours'])

const plannerPrompt = `你是 AeroLog 只读查询规划器。根据用户问题，仅输出一个 JSON 对象，不要 Markdown、解释或 SQL。
可选 skill 仅有：ads_summary、server_status、kafka_status、disk_usage、directory_usage。
ads_summary 用于指定项目的广告、ad_show、广告数据；params 必须包含 time_range：today、yesterday 或 last_hours。用户说“近/最近 N 小时”时，必须使用 {"time_range":"last_hours","hours":N}；未指定时间时用 today。其他 skill 的 params 必须是 {}。
server_status 用于服务器或主机资源与服务状态；kafka_status 用于 Kafka、消息队列、积压、DLQ；disk_usage 用于挂载点磁盘占用；directory_usage 用于哪些目录/文件占空间。
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
  return `查询完成，AI 整理超时。原始结果：\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
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
        { role: 'system', content: '你是 AeroLog 运维与数据助手。只能根据提供的 JSON 数据回答，不得编造数据。用简短中文 Markdown 整理结果。skill=server_status 时列 CPU、内存、磁盘、API、采集服务状态；skill=disk_usage 时按使用率降序列出挂载点；skill=directory_usage 时按 bytes 降序列出目录及大小，并说明只扫描白名单目录；skill=kafka_status 时列消费者、lag、DLQ；广告数据时列时间范围、总次数、去重用户数、主要事件。缺失或 unavailable 必须明确说明。' },
        { role: 'user', content: `问题：${question}\n\n受限查询结果：${JSON.stringify(data)}` },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'AI 请求失败')
  return payload?.choices?.[0]?.message?.content?.trim() || 'AI 未返回内容'
}

bot.on('authenticated', () => console.log('wecom aibot authenticated'))
bot.on('message.text', async (frame) => {
  const content = frame.body?.text?.content?.trim()
  if (!content) return
  const streamID = generateReqId('aerolog')
  try {
    await bot.replyStream(frame, streamID, '正在理解问题并查询 AeroLog 数据…', false)
    let plan
    try {
      plan = await planSkill(content)
    } catch (error) {
      console.warn('AI 查询规划失败，使用规则兜底', error instanceof Error ? error.message : error)
      plan = fallbackPlan(content)
    }
    const data = await queryAnalytics(content, plan)
    let answer
    try {
      answer = await summarize(content, data)
    } catch (error) {
      console.warn('AI 数据整理失败，使用固定格式', error instanceof Error ? error.message : error)
      answer = fallbackSummary(data)
    }
    await bot.replyStream(frame, streamID, answer, true)
  } catch (error) {
    console.error('wecom bot request failed', error instanceof Error ? error.message : error)
    await bot.replyStream(frame, streamID, `查询失败：${error instanceof Error ? error.message : '未知错误'}`, true)
  }
})
bot.connect()

process.on('SIGTERM', () => { bot.disconnect(); process.exit(0) })
