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

async function queryAnalytics(question) {
  const response = await fetch(`${apiURL}/v1/internal/wecom-bot/analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AeroLog-Bot-Token': process.env.AEROLOG_WECOM_BOT_INTERNAL_TOKEN },
    body: JSON.stringify({ question }),
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
        { role: 'system', content: '你是 AeroLog 数据分析助手。只能根据提供的 JSON 数据回答，不得编造数据。用简短中文 Markdown：先时间范围，再总次数、去重用户数、主要事件，最后一句数据解读。若事件为空，明确说明没有匹配的广告事件。' },
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
    await bot.replyStream(frame, streamID, '正在查询 AeroLog 数据…', false)
    const data = await queryAnalytics(content)
    await bot.replyStream(frame, streamID, await summarize(content, data), true)
  } catch (error) {
    console.error('wecom bot request failed', error instanceof Error ? error.message : error)
    await bot.replyStream(frame, streamID, `查询失败：${error instanceof Error ? error.message : '未知错误'}`, true)
  }
})
bot.connect()

process.on('SIGTERM', () => { bot.disconnect(); process.exit(0) })
