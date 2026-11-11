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
    signal: AbortSignal.timeout(30000),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload?.error?.message || 'AI 查询规划失败')
  return parsePlan(payload?.choices?.[0]?.message?.content?.trim() || '')
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
    signal: AbortSignal.timeout(30000),
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
    const plan = await planSkill(content)
    const data = await queryAnalytics(content, plan)
    await bot.replyStream(frame, streamID, await summarize(content, data), true)
  } catch (error) {
    console.error('wecom bot request failed', error instanceof Error ? error.message : error)
    await bot.replyStream(frame, streamID, `查询失败：${error instanceof Error ? error.message : '未知错误'}`, true)
  }
})
bot.connect()

process.on('SIGTERM', () => { bot.disconnect(); process.exit(0) })
