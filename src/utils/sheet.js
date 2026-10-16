/* ============================================================
   表格读取器：.xlsx / .csv  →  二维数组
   ------------------------------------------------------------
   不引 SheetJS 之类的库（压缩后 300KB+，且 npm 上的版本偏旧）。
   .xlsx 本质是一个 ZIP 包，里面是若干 XML：
     xl/sharedStrings.xml   共享字符串表
     xl/worksheets/sheet1.xml  单元格数据
   浏览器 / Node 18+ 都自带 DecompressionStream('deflate-raw')，
   于是这里手写一个「够用的」读取器，只支持读、只支持第一张表，
   对本项目的导入场景完全够，产物体积为零。
   ============================================================ */

/* ---------------- ZIP ---------------- */
const SIG_EOCD = 0x06054b50
const SIG_CEN = 0x02014b50
const SIG_LOC = 0x04034b50

const u16 = (dv, o) => dv.getUint16(o, true)
const u32 = (dv, o) => dv.getUint32(o, true)

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压 xlsx，请把文件另存为 CSV 后再导入')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 解析 ZIP 的中央目录，得到「文件名 → 条目信息」 */
function readZipDir(buffer) {
  const bytes = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  let eocd = -1
  const min = Math.max(0, bytes.length - 22 - 65535)
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(dv, i) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx 文件（找不到 ZIP 结构）')

  const count = u16(dv, eocd + 10)
  let off = u32(dv, eocd + 16)
  const files = {}
  for (let i = 0; i < count; i++) {
    if (off + 46 > bytes.length || u32(dv, off) !== SIG_CEN) break
    const fnLen = u16(dv, off + 28)
    const exLen = u16(dv, off + 30)
    const cmLen = u16(dv, off + 32)
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + fnLen))
    files[name] = {
      method: u16(dv, off + 10),
      csize: u32(dv, off + 20),
      lho: u32(dv, off + 42),
    }
    off += 46 + fnLen + exLen + cmLen
  }
  return { bytes, dv, files }
}

/** 取出某个条目的原始内容（必要时解压）。
    压缩大小取自中央目录而不是本地头 —— 有些写入器在本地头里写 0
    并改用 data descriptor，取本地头会读到 0 字节。 */
async function zipEntry(zip, name) {
  const f = zip.files[name]
  if (!f) return null
  const { bytes, dv } = zip
  if (u32(dv, f.lho) !== SIG_LOC) throw new Error('xlsx 内部结构异常')
  const start = f.lho + 30 + u16(dv, f.lho + 26) + u16(dv, f.lho + 28)
  const raw = bytes.subarray(start, start + f.csize)
  if (f.method === 0) return raw
  if (f.method === 8) return inflateRaw(raw)
  throw new Error('xlsx 使用了不支持的压缩方式（' + f.method + '）')
}

/* ---------------- XML ---------------- */
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&') // 必须最后，否则 &amp;lt; 会被二次解码
}

const textOf = (xml) => {
  if (!xml) return ''
  let out = ''
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g
  let m
  while ((m = re.exec(xml))) out += decodeEntities(m[1])
  return out
}

function parseSharedStrings(xml) {
  if (!xml) return []
  const out = []
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g
  let m
  while ((m = re.exec(xml))) out.push(textOf(m[1]))
  return out
}

/** "AB12" → 27（0 基列号） */
function colIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '')
  if (!m) return -1
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function parseSheet(xml, shared) {
  const rows = []
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(xml))) {
    const rRef = /r="(\d+)"/.exec(rm[1])
    const rIdx = rRef ? Number(rRef[1]) - 1 : rows.length
    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[2]))) {
      const attrs = cm[1]
      const body = cm[2] || ''
      const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1]
      const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || 'n'
      const ci = ref ? colIndex(ref) : cells.length
      if (ci < 0) continue

      let val = ''
      if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        val = v ? shared[Number(v[1])] ?? '' : ''
      } else if (type === 'inlineStr') {
        val = textOf(body)
      } else if (type === 'str') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        val = v ? decodeEntities(v[1]) : ''
      } else if (type === 'b') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        val = v && v[1] === '1' ? 'TRUE' : 'FALSE'
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)
        const raw = v ? decodeEntities(v[1]) : ''
        val = raw !== '' && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(raw) ? Number(raw) : raw
      }
      cells[ci] = val
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    rows[rIdx] = cells
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  return rows
}

function firstSheetPath(files) {
  const names = Object.keys(files)
  if (names.includes('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml'
  return names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0] || null
}

/* ---------------- CSV ---------------- */
export function parseCsv(text) {
  const s = String(text ?? '').replace(/^\ufeff/, '')
  if (!s.trim()) return []
  // 探测分隔符（逗号 / 制表符 / 分号）
  const nl = s.search(/\r?\n/)
  const head = nl === -1 ? s : s.slice(0, nl)
  const cand = [',', '\t', ';'].map((d) => [d, head.split(d).length - 1])
  cand.sort((a, b) => b[1] - a[1])
  const delim = cand[0][1] > 0 ? cand[0][0] : ','

  const rows = []
  let row = []
  let field = ''
  let inQ = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQ = false
      } else field += c
    } else if (c === '"') {
      inQ = true
    } else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/* ---------------- 对外入口 ---------------- */
/**
 * 读取上传的表格文件。
 * @returns {Promise<{rows: any[][], source: 'xlsx'|'csv'|'text'}>}
 */
export async function readSheet(file) {
  const name = String(file.name || '').toLowerCase()

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return { rows: parseCsv(await file.text()), source: 'csv' }
  }

  const buf = await file.arrayBuffer()
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))

  // 旧版 .xls 是 OLE 复合文档（D0 CF 11 E0），不是 ZIP，读不了
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
    throw new Error('这是旧版 .xls 格式，读不了。请用 Excel 打开后「另存为 .xlsx」或「另存为 CSV」再上传')
  }

  // 有些「.xlsx」其实是直接改后缀的 CSV / HTML，这里做一次兜底
  if (!(head[0] === 0x50 && head[1] === 0x4b)) {
    const text = new TextDecoder('utf-8').decode(buf)
    if (/<html|<!doctype/i.test(text.slice(0, 200))) {
      throw new Error('这个文件其实是网页（HTML），不是 Excel。请用 Excel 打开后「另存为 .xlsx」再上传')
    }
    return { rows: parseCsv(text), source: 'text' }
  }

  const zip = readZipDir(buf)
  const sheetPath = firstSheetPath(zip.files)
  if (!sheetPath) throw new Error('xlsx 里没有找到工作表')
  const sheetXml = new TextDecoder('utf-8').decode(await zipEntry(zip, sheetPath))
  const sharedXml = zip.files['xl/sharedStrings.xml']
    ? new TextDecoder('utf-8').decode(await zipEntry(zip, 'xl/sharedStrings.xml'))
    : ''
  return { rows: parseSheet(sheetXml, parseSharedStrings(sharedXml)), source: 'xlsx' }
}
