import { deflateSync } from 'node:zlib'

const width = 800
const height = 420
const palette = {
  background: [255, 255, 255],
  grid: [226, 232, 240],
  axis: [148, 163, 184],
  line: [22, 163, 74],
  fill: [220, 252, 231],
  text: [71, 85, 105],
}

// renderTrendChartPng 生成不依赖外部服务的简易趋势 PNG。
export function renderTrendChartPng(chart) {
  const labels = Array.isArray(chart?.labels) ? chart.labels.map(String) : []
  const values = Array.isArray(chart?.values) ? chart.values.map((value) => Number(value) || 0) : []
  if (!labels.length || labels.length !== values.length || labels.length > 31) return null
  const pixels = new Uint8Array(width * height * 4)
  fill(pixels, palette.background)
  const area = { left: 64, right: width - 28, top: 34, bottom: height - 54 }
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  const yFor = (value) => Math.round(area.bottom - ((value - min) / span) * (area.bottom - area.top))
  const xFor = (index) => labels.length === 1
    ? Math.round((area.left + area.right) / 2)
    : Math.round(area.left + (index * (area.right - area.left)) / (labels.length - 1))

  for (let tick = 0; tick <= 4; tick += 1) {
    const y = Math.round(area.top + (tick * (area.bottom - area.top)) / 4)
    line(pixels, area.left, y, area.right, y, palette.grid)
    drawText(pixels, 8, y - 4, compactNumber(max - (tick * span) / 4), palette.text)
  }
  line(pixels, area.left, area.top, area.left, area.bottom, palette.axis)
  line(pixels, area.left, area.bottom, area.right, area.bottom, palette.axis)

  if (chart.type === 'bar') {
    const slot = (area.right - area.left) / labels.length
    const barWidth = Math.max(4, Math.floor(slot * 0.62))
    values.forEach((value, index) => {
      const x = Math.round(xFor(index) - barWidth / 2)
      const y = yFor(value)
      rectangle(pixels, x, y, barWidth, area.bottom - y, palette.line)
    })
  } else {
    const points = values.map((value, index) => [xFor(index), yFor(value)])
    for (let index = 1; index < points.length; index += 1) {
      line(pixels, points[index - 1][0], points[index - 1][1], points[index][0], points[index][1], palette.line)
    }
    points.forEach(([x, y]) => circle(pixels, x, y, 4, palette.line))
  }

  const labelStep = Math.max(1, Math.ceil(labels.length / 7))
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return
    const text = label.replace(/^\d{4}-/, '')
    drawText(pixels, Math.max(area.left, xFor(index) - Math.floor(text.length * 3)), area.bottom + 16, text, palette.text)
  })
  return encodePng(pixels)
}

function fill(pixels, color) {
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = color[0]
    pixels[index + 1] = color[1]
    pixels[index + 2] = color[2]
    pixels[index + 3] = 255
  }
}

function setPixel(pixels, x, y, color) {
  if (x < 0 || x >= width || y < 0 || y >= height) return
  const index = (y * width + x) * 4
  pixels[index] = color[0]
  pixels[index + 1] = color[1]
  pixels[index + 2] = color[2]
  pixels[index + 3] = 255
}

function line(pixels, fromX, fromY, toX, toY, color) {
  let x = fromX
  let y = fromY
  const deltaX = Math.abs(toX - fromX)
  const deltaY = Math.abs(toY - fromY)
  const stepX = fromX < toX ? 1 : -1
  const stepY = fromY < toY ? 1 : -1
  let error = deltaX - deltaY
  while (true) {
    setPixel(pixels, x, y, color)
    if (x === toX && y === toY) return
    const doubleError = error * 2
    if (doubleError > -deltaY) {
      error -= deltaY
      x += stepX
    }
    if (doubleError < deltaX) {
      error += deltaX
      y += stepY
    }
  }
}

function rectangle(pixels, x, y, rectWidth, rectHeight, color) {
  for (let row = y; row <= y + rectHeight; row += 1) {
    for (let column = x; column <= x + rectWidth; column += 1) setPixel(pixels, column, row, color)
  }
}

function circle(pixels, centerX, centerY, radius, color) {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) setPixel(pixels, x, y, color)
    }
  }
}

const glyphs = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '11100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
}

function drawText(pixels, x, y, text, color) {
  let offset = 0
  for (const char of text) {
    const glyph = glyphs[char]
    if (!glyph) {
      offset += 6
      continue
    }
    glyph.forEach((row, rowIndex) => {
      for (let column = 0; column < row.length; column += 1) {
        if (row[column] === '1') setPixel(pixels, x + offset + column, y + rowIndex, color)
      }
    })
    offset += 6
  }
}

function compactNumber(value) {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}`
  return Number(value).toFixed(value % 1 === 0 ? 0 : 1)
}

function encodePng(pixels) {
  const rows = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1)
    rows[target] = 0
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(rows, target + 1)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', Buffer.from([0, 0, 3, 32, 0, 0, 1, 164, 8, 6, 0, 0, 0])),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])) >>> 0)
  return Buffer.concat([length, typeBuffer, data, checksum])
}

function crc32(data) {
  let value = 0xffffffff
  for (const byte of data) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return value ^ 0xffffffff
}
