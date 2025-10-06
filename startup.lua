local CURRENT_STATION_CODE = '01-01'
-- FTC Ticketing System – Ticket Machine
-- Runtime: CC:Tweaked (ComputerCraft)
-- Purpose: Ticket vending UI, audio, printing, floppy TICKET writing, sales upload
-- Key settings: CURRENT_STATION_CODE; API base via API_ENDPOINT.txt
-- Comment style: concise, consistent English for open-source
-- MADE BY Henry_Du henrydu@henrycloud.ink 

local dfpwm = require('cc.audio.dfpwm')

-- Initialize RNG to avoid repeated sequences across reboots
do
  local seed = os.epoch('utc')
  if type(seed) ~= 'number' then seed = tonumber(os.time and os.time() or 0) or 0 end
  math.randomseed(seed)
  -- warm up
  math.random(); math.random(); math.random()
end

-- Generate a unique ticket id per sale: time-based prefix + random suffix
local function generateTicketId()
  local t = 0
  if os and os.epoch then t = os.epoch('utc')
  elseif os and os.time then t = os.time() * 1000 end
  if type(t) ~= 'number' then t = 0 end
  local prefix = math.floor(t % 10000000) -- last 7 digits of ms epoch
  local suffix = math.random(0, 99)
  return string.format('%07d-%02d', prefix, suffix)
end

-- ###########################
-- Peripheral discovery
-- ###########################
local monitor = peripheral.find('monitor')
local speaker = peripheral.find('speaker')
local printer = peripheral.find('printer')
local modem = nil
local MODEM_CHANNEL = 65000
local AUDIO_CHANNEL = 65005

local function ensureModem()
  -- Restrict to only the front-side modem
  modem = nil
  if peripheral.isPresent('left') and peripheral.hasType('left', 'modem') then
    modem = peripheral.wrap('left')
    if modem then
      if not (type(modem.isOpen) == 'function' and modem.isOpen(MODEM_CHANNEL)) then
        pcall(modem.open, MODEM_CHANNEL)
      end
      if not (type(modem.isOpen) == 'function' and modem.isOpen(AUDIO_CHANNEL)) then
        pcall(modem.open, AUDIO_CHANNEL)
      end
      -- Open Rednet on front for CC:Tweaked compatibility
      pcall(rednet.open, 'left')
    end
  end
  return modem
end

-- Simple diagnostics to verify modem presence and channel state
local function diagnoseModem()
  if not modem then
    print('Modem: not found')
    return
  end
  local name = peripheral.getName(modem)
  local wireless = (type(modem.isWireless) == 'function' and modem.isWireless()) or false
  local open = (type(modem.isOpen) == 'function' and modem.isOpen(MODEM_CHANNEL)) or false
  local rnOpen = false
  if type(rednet) == 'table' and rednet.isOpen and type(name) == 'string' then rnOpen = rednet.isOpen(name) end
  print(('Modem %s, wireless=%s, open=%s, rednet=%s'):format(tostring(name), tostring(wireless), tostring(open), tostring(rnOpen)))
end

local function safe(term)
  if monitor then return peripheral.wrap(peripheral.getName(monitor)) end
  return term
end

local termDev = safe(term)
-- 先设置文本缩放，再测量尺寸，避免首次启动界面错位
if monitor then pcall(monitor.setTextScale, 0.5) end
local w, h = termDev.getSize()

-- Monitor aesthetics
-- 文本缩放已提前设置

-- Deployment settings: set current station here for display
-- Change this code per deployment; name will be derived from data

-- Hardcoded API base for device-side synchronization (set to your server)
local API_BASE = 'http://192.140.163.241:23333/api'


-- Always output redstone on back while program runs (spec requirement)
redstone.setOutput('back', true)

-- ###########################
-- Config and data fetching
-- ###########################
local function readFile(path)
  if not fs.exists(path) then return nil end
  local h = fs.open(path, 'r')
  local c = h.readAll()
  h.close()
  return c
end

local function writeFile(path, content)
  local h = fs.open(path, 'w')
  if not h then return false end
  h.write(content)
  h.close()
  return true
end

-- ###########################
-- Stats: sales & revenue + upload
-- ###########################
local TICKET_STATS_PATH = 'logs/ticket_stats.json'
local API_ENDPOINT_TICKET_PATH = 'API_ENDPOINT_TICKET.txt'
local function ensureDir(path)
  local dir = path:match('^(.+)/[^/]+$')
  if dir and not fs.exists(dir) then pcall(fs.makeDir, dir) end
end
local function loadTicketStats()
  local def = { sold_tickets = 0, sold_trips = 0, revenue = 0 }
  if not fs.exists(TICKET_STATS_PATH) then return def end
  local ok, data = pcall(textutils.unserializeJSON, readFile(TICKET_STATS_PATH) or '')
  if ok and type(data) == 'table' then
    for k, v in pairs(def) do if type(data[k]) ~= 'number' then data[k] = v end end
    return data
  end
  return def
end
local function saveTicketStats(stats)
  ensureDir(TICKET_STATS_PATH)
  local ok, s = pcall(textutils.serializeJSON, stats)
  if not ok or type(s) ~= 'string' then s = textutils.serialize(stats) end
  writeFile(TICKET_STATS_PATH, s)
end
local function readApiEndpoint(path)
  if fs.exists(path) then
    local s = (readFile(path) or ''):gsub('%s+$','')
    if #s > 0 then return s end
  end
  if fs.exists('API_ENDPOINT.txt') then
    local s = (readFile('API_ENDPOINT.txt') or ''):gsub('%s+$','')
    if #s > 0 then return s end
  end
  return nil
end
local function uploadTicketStats(stats)
  local url = readApiEndpoint(API_ENDPOINT_TICKET_PATH)
  if not url or not http or not http.post then return false end
  local window_hour = os.date('%Y%m%d%H')
  local window_day = os.date('%Y%m%d')
  local bodyOk, body = pcall(textutils.serializeJSON, {
    device = 'ticket_machine',
    station_code = (state.stationCode or '00-00'),
    station_name = (state.stationName or 'Station'),
    sold_tickets = stats.sold_tickets,
    sold_trips = stats.sold_trips,
    revenue = stats.revenue,
    ts = os.epoch('utc'),
    window_hour = window_hour,
    window_day = window_day,
  })
  if not bodyOk then return false end
  local ok, res = pcall(http.post, url, body, { ['Content-Type'] = 'application/json' })
  if ok and res then res.close() end
  return ok
end

-- 上传售票事件：在 showDone 完成后调用 /api/tickets/sale
-- Upload sale event: invoked after showDone, POST to /api/tickets/sale
local function postTicketSale(payload)
  local base = readApiEndpoint('API_ENDPOINT.txt') or ''
  if (not http or not http.post) or base == '' then return false end
  local url = (base:match('/api$') and base or (base .. '/api')) .. '/tickets/sale'
  local okBody, body = pcall(textutils.serializeJSON, payload)
  if not okBody then return false end
  local ok, res = pcall(http.post, url, body, { ['Content-Type'] = 'application/json' })
  if ok and res then res.close() end
  return ok
end
local function jsonDecode(str)
  local ok, res = pcall(textutils.unserializeJSON, str)
  if ok then return res else return nil end
end

local function fetchHTTP(url)
  if not http or not http.get then return nil end
  local ok, res = pcall(http.get, url)
  if not ok or not res then return nil end
  local data = res.readAll()
  res.close()
  return data
end

local function loadConfig()
  -- Try HTTP first, then local fallback
  local localCfg = readFile('config.json')
  local base = API_BASE
  local initial = localCfg and jsonDecode(localCfg) or nil
  local remote = nil
  if base and #base > 0 then
    remote = fetchHTTP(base) or fetchHTTP(base .. '/config')
  end
  -- If remote fetched, remove old file and write new snapshot
  if remote then
    pcall(fs.delete, 'config.json')
    writeFile('config.json', remote)
  end
  local cfgText = remote or localCfg
  local cfg = cfgText and jsonDecode(cfgText) or {
    api_base = API_BASE,
    current_station = { name = '', code = '' },
    stations = {},
    lines = {},
    fares = {}
  }
  return cfg
end

local CFG = loadConfig()

-- Periodic refresh from API (polling)
local REFRESH_INTERVAL = 10  -- seconds; adjust as needed
local AUDIO_SYNC_INTERVAL = 60 -- seconds; periodic station audio sync (extended)
local ui_dirty = false       -- mark UI dirty after refresh to trigger redraw
local refreshTimerId = nil
local audioSyncTimerId = nil
local lastAudioListHash = nil
local last_api_ok = false    -- whether the last API refresh succeeded

-- Maps and adjacency; rebuilt on refresh
local stationByCode, linesById, adjacency_regular, adjacency_express = {}, {}, {}, {}
local function rebuildMaps()
  stationByCode = {}
  for _, s in ipairs(CFG.stations or {}) do stationByCode[s.code] = s end
  linesById = {}
  for _, l in ipairs(CFG.lines or {}) do linesById[l.id] = l end
  adjacency_regular, adjacency_express = {}, {}
  for _, e in ipairs(CFG.fares or {}) do
    local cr = e.cost_regular ~= nil and e.cost_regular or e.cost
    local ce = e.cost_express ~= nil and e.cost_express or e.cost
    adjacency_regular[e.from] = adjacency_regular[e.from] or {}
    adjacency_regular[e.to] = adjacency_regular[e.to] or {}
    adjacency_regular[e.from][e.to] = cr
    adjacency_regular[e.to][e.from] = cr
    adjacency_express[e.from] = adjacency_express[e.from] or {}
    adjacency_express[e.to] = adjacency_express[e.to] or {}
    adjacency_express[e.from][e.to] = ce
    adjacency_express[e.to][e.from] = ce
  end
  -- Auto-detect equivalent stations: treat same Chinese/English name as one physical station and add zero-cost transfers
  do
    local groups = {}
    local function keyOf(s)
      local k = ((s.en_name or s.name) or '')
      k = string.lower(k)
      k = k:gsub('%s+', '')
      return k
    end
    for _, s in ipairs(CFG.stations or {}) do
      local k = keyOf(s)
      if k and #k > 0 then
        groups[k] = groups[k] or {}
        table.insert(groups[k], s.code)
      end
    end
    for _, arr in pairs(groups) do
      if #arr >= 2 then
        for i=1,#arr do
          for j=1,#arr do
            if i ~= j then
              local a, b = arr[i], arr[j]
              adjacency_regular[a] = adjacency_regular[a] or {}
              adjacency_regular[b] = adjacency_regular[b] or {}
              adjacency_regular[a][b] = math.min(adjacency_regular[a][b] or math.huge, 0)
              adjacency_regular[b][a] = math.min(adjacency_regular[b][a] or math.huge, 0)
              adjacency_express[a] = adjacency_express[a] or {}
              adjacency_express[b] = adjacency_express[b] or {}
              adjacency_express[a][b] = math.min(adjacency_express[a][b] or math.huge, 0)
              adjacency_express[b][a] = math.min(adjacency_express[b][a] or math.huge, 0)
            end
          end
        end
      end
    end
    -- 确保所有站点存在于邻接表中，避免路径搜索时缺席
    for _, s in ipairs(CFG.stations or {}) do
      adjacency_regular[s.code] = adjacency_regular[s.code] or {}
      adjacency_express[s.code] = adjacency_express[s.code] or {}
    end
  end
  -- 等价站映射：为每一对增加0成本的双向连边，实现一次换乘
  for _, p in ipairs(CFG.transfers or {}) do
    local a, b = tostring(p[1] or ''), tostring(p[2] or '')
    if #a > 0 and #b > 0 then
      adjacency_regular[a] = adjacency_regular[a] or {}
      adjacency_regular[b] = adjacency_regular[b] or {}
      adjacency_regular[a][b] = math.min(adjacency_regular[a][b] or math.huge, 0)
      adjacency_regular[b][a] = math.min(adjacency_regular[b][a] or math.huge, 0)
      adjacency_express[a] = adjacency_express[a] or {}
      adjacency_express[b] = adjacency_express[b] or {}
      adjacency_express[a][b] = math.min(adjacency_express[a][b] or math.huge, 0)
      adjacency_express[b][a] = math.min(adjacency_express[b][a] or math.huge, 0)
    end
  end
end
rebuildMaps()

-- Apply deployment current station override early
do
  if type(CURRENT_STATION_CODE) == 'string' and #CURRENT_STATION_CODE > 0 then
    local s = stationByCode[CURRENT_STATION_CODE]
    local en = (s and s.en_name) or (s and s.name) or 'Station'
    CFG.current_station = { code = CURRENT_STATION_CODE, en_name = en, name = (s and s.name) or en }
  end
end

local function refreshConfigOnce()
  -- Use hardcoded API base for polling
  local base = API_BASE
  last_api_ok = false
  if not base or #base == 0 then last_api_ok = false; return end

  -- Build robust candidate URLs to tolerate different deployments
  local candidates = {}
  local function push(u)
    candidates[#candidates+1] = u
  end
  -- If base already points to '/api', try it directly and its '/config'
  push(base)
  push(base .. '/config')
  -- Also try '/api' and '/api/config' when base is root host
  if not string.find(base, '/api') then
    push(base .. '/api')
    push(base .. '/api/config')
  end
  -- Some servers expose '/config.json'
  push(base .. '/config.json')

  local txt
  for _, url in ipairs(candidates) do
    -- Optional: preflight URL check (if available)
    if http and http.checkURL then
      local okCheck = false
      local ok, res = pcall(http.checkURL, url)
      okCheck = ok and res or false
      if not okCheck then
        -- Skip obviously invalid URLs, continue to next candidate
        goto continue
      end
    end
    txt = fetchHTTP(url)
    if txt and #txt > 0 then
      local cfgTry = jsonDecode(txt)
      if cfgTry and type(cfgTry) == 'table' and cfgTry.stations and cfgTry.lines then
        -- Apply as soon as a valid config is found
        CFG = cfgTry
        rebuildMaps()
        ui_dirty = true
        last_api_ok = true
        -- Persist snapshot locally
        pcall(fs.delete, 'config.json')
        writeFile('config.json', txt)
        return
      end
    end
    ::continue::
  end
  -- If we reached here, all candidates failed
  last_api_ok = false
end

local function ensureRefreshTimer()
  if not refreshTimerId then refreshTimerId = os.startTimer(REFRESH_INTERVAL) end
end
ensureRefreshTimer()
local function ensureAudioSyncTimer() end
-- Disable periodic audio sync; audio list will be requested once on Home
-- Initialize modem and keep channel open; also attempt one-time audio sync at boot
ensureModem()
diagnoseModem()

-- ###########################
-- Utility: audio playing
-- ###########################
local decoder = dfpwm.make_decoder()
local audioQueue = {}
local currentChunkReader = nil
-- 前向声明，供 waitAudioComplete 使用
local processSpeakerEmpty

local function stopAudio()
  audioQueue = {}
  currentChunkReader = nil
  if speaker and speaker.stop then pcall(speaker.stop) end
end

local function isAudioBusy()
  return (currentChunkReader ~= nil) or ((audioQueue ~= nil) and (#audioQueue > 0))
end

local function waitAudioComplete()
  -- 阻塞直到队列播完；在关键页面使用（欢迎、订单、出票）
  -- 同时兼容某些环境下未触发 speaker_audio_empty 的情况，主动推进一次
  local safety = 0
  while isAudioBusy() do
    local evt
    if os.pullEvent then
      evt = { pcall(os.pullEvent) }
    end
    -- 当事件无法拉取或并非 speaker_audio_empty，也主动推进一次
    if processSpeakerEmpty then processSpeakerEmpty() end
    safety = safety + 1
    if safety > 10000 then -- 兜底：避免极端情况下无限阻塞
      break
    end
  end
end

local function enqueueAudio(path)
  if not speaker or not fs.exists(path) then return end
  table.insert(audioQueue, path)
  -- Kick the processing loop via event so it's non-blocking
  os.queueEvent('speaker_audio_empty')
end

local function playDFPWM(path)
  enqueueAudio(path)
end

processSpeakerEmpty = function()
  if not speaker then return end
  if not currentChunkReader then
    if #audioQueue == 0 then return end
    local path = table.remove(audioQueue, 1)
    local f = io.open(path, 'rb')
    if not f then currentChunkReader = nil; return end
    currentChunkReader = function()
      local chunk = f:read(16 * 1024)
      if chunk then return chunk else f:close(); return nil end
    end
  end
  local chunk = currentChunkReader and currentChunkReader()
  if not chunk then currentChunkReader = nil; return end
  local buffer = decoder(chunk)
  -- At speaker_audio_empty, playAudio should accept immediately
  pcall(speaker.playAudio, buffer)
end

local function clickSound()
  if speaker then pcall(speaker.playNote, 'pling', 3, 12) end
end

local function playStationVoice(code)
  -- Play station voice from unified path: Audio/ch-<code>.dfpwm
  local p = 'Audio/ch-' .. code .. '.dfpwm'
  if fs.exists(p) then playDFPWM(p) end
end

local function playCostVoices(cost)
  local hundreds = math.floor(cost / 100)
  local tens = math.floor((cost % 100) / 10)
  local ones = cost % 10
  if cost == 0 then
    -- 票价为0时，仅播报“零”
    if fs.exists('Audio/0.dfpwm') then playDFPWM('Audio/0.dfpwm') end
    return
  end
  if hundreds > 0 then playDFPWM('Audio/' .. hundreds .. 'b.dfpwm') end
  if tens > 0 then playDFPWM('Audio/' .. tens .. 's.dfpwm') end
  if ones > 0 then playDFPWM('Audio/' .. ones .. '.dfpwm') end
end

-- Sync station audio files from central processor via wireless modem (channel 65000)
-- Protocol expectation: server responds with multiple messages { cmd='AUD_FILE', name='<filename>', data='<file content>' }
-- upon receiving { cmd='AUD_SYNC', path='/Audio/Station' }
local function syncStationAudio()
  if not ensureModem() then print('Audio sync: modem not present (front).'); return end
  local ch = AUDIO_CHANNEL
  if type(modem.isOpen) == 'function' and not modem.isOpen(ch) then pcall(modem.open, ch) end
  fs.makeDir('Audio')
  local req = { cmd = 'AUD_SYNC', path = '/AudioT/Station' }
  local payload
  if textutils.serializeJSON then
    payload = textutils.serializeJSON(req)
  else
    payload = textutils.serialize(req)
  end
  print(('Audio sync: request on ch=%d via front modem'):format(ch))
  pcall(modem.transmit, ch, ch, payload)
  -- Also try rednet broadcast with same table (in case server listens on rednet)
  if rednet and rednet.broadcast then pcall(rednet.broadcast, req, 'AUD_SYNC') end
  -- Non-blocking: responses are handled in main event loop (rednet_message)
end

-- Request audio file list; if changed, then sync
local function requestAudioList()
  if not ensureModem() then print('Audio list: modem not present (front).'); return end
  local ch = AUDIO_CHANNEL
  if type(modem.isOpen) == 'function' and not modem.isOpen(ch) then pcall(modem.open, ch) end
  local req = { cmd = 'AUD_LIST' }
  local payload
  if textutils.serializeJSON then payload = textutils.serializeJSON(req) else payload = textutils.serialize(req) end
  pcall(modem.transmit, ch, ch, payload)
  if rednet and rednet.broadcast then pcall(rednet.broadcast, req, 'AUD_LIST') end
end

-- Perform boot-time audio sync now that function is defined
-- (disabled) Sync will be triggered only when entering Home and receiving list changes

-- ###########################
-- Utility: path finding and cost
-- ###########################
local function computeCost(src, dst, trainType)
  if src == dst then return 0 end
  -- Dijkstra across adjacency
  local dist, prev = {}, {}
  local Q = {}
  local adj = (trainType == 'Express') and adjacency_express or adjacency_regular
  -- 确保起讫站存在于图中
  if not adj[src] then adj[src] = {} end
  if not adj[dst] then adj[dst] = {} end
  for code, _ in pairs(adj) do dist[code] = math.huge; Q[#Q+1] = code end
  dist[src] = 0
  local function extractMin()
    local bestI, bestC
    for i, c in ipairs(Q) do
      if bestI == nil or dist[c] < dist[bestC] then bestI, bestC = i, c end
    end
    if not bestI then return nil end
    table.remove(Q, bestI)
    return bestC
  end
  while true do
    local u = extractMin()
    if not u then break end
    if u == dst then break end
    for v, w in pairs(adj[u] or {}) do
      if dist[u] + w < (dist[v] or math.huge) then
        dist[v] = dist[u] + w
        prev[v] = u
      end
    end
  end
  -- If unreachable, avoid returning math.huge to prevent 'inf' fare display
  local res = dist[dst]
  if res == nil or res == math.huge or res ~= res then
    return 0
  end
  return res
end

local function linesForStation(code)
  local list = {}
  for _, l in ipairs(CFG.lines) do
    for _, s in ipairs(l.stations) do
      if s == code then table.insert(list, l); break end
    end
  end
  return list
end

-- Same-station check: normalize by English/Chinese name, ignore case and spaces
local function stationKeyByCode(code)
  if not code then return '' end
  local s = stationByCode[code]
  local k = (s and (s.en_name or s.name)) or code
  k = string.lower(k)
  k = k:gsub('%s+', '')
  return k
end

-- ###########################
-- UI helpers
-- ###########################
-- Color helpers: support HEX(#RRGGBB) → nearest CC:Tweaked 16-color
local CC_PALETTE = {
  {name='white',     val=colors.white,     rgb={0xF2,0xF2,0xF2}},
  {name='orange',    val=colors.orange,    rgb={0xF2,0xB2,0x33}},
  {name='magenta',   val=colors.magenta,   rgb={0xE5,0x7F,0xD8}},
  {name='lightBlue', val=colors.lightBlue, rgb={0x99,0xB2,0xF2}},
  {name='yellow',    val=colors.yellow,    rgb={0xDE,0xDE,0x6C}},
  {name='lime',      val=colors.lime,      rgb={0x7F,0xCC,0x19}},
  {name='pink',      val=colors.pink,      rgb={0xF2,0xB2,0xCC}},
  {name='gray',      val=colors.gray,      rgb={0x4C,0x4C,0x4C}},
  {name='lightGray', val=colors.lightGray, rgb={0x99,0x99,0x99}},
  {name='cyan',      val=colors.cyan,      rgb={0x4C,0x99,0xB2}},
  {name='purple',    val=colors.purple,    rgb={0xB2,0x66,0xE5}},
  {name='blue',      val=colors.blue,      rgb={0x33,0x66,0xCC}},
  {name='brown',     val=colors.brown,     rgb={0x7F,0x66,0x4C}},
  {name='green',     val=colors.green,     rgb={0x57,0xA6,0x4E}},
  {name='red',       val=colors.red,       rgb={0xCC,0x4C,0x4C}},
  {name='black',     val=colors.black,     rgb={0x11,0x11,0x11}},
}

local function parseHexRGB(s)
  if type(s) ~= 'string' then return nil end
  local hex = s
  if hex:sub(1,1) == '#' then hex = hex:sub(2) end
  if #hex == 6 and hex:match('^[0-9A-Fa-f]+$') then
    local r = tonumber(hex:sub(1,2), 16)
    local g = tonumber(hex:sub(3,4), 16)
    local b = tonumber(hex:sub(5,6), 16)
    return {r,g,b}
  end
  return nil
end

local function nearestCCColor(val)
  -- val can be HEX (#RRGGBB) or CC color name
  if type(val) ~= 'string' then return colors.gray end
  local rgb = parseHexRGB(val)
  if not rgb then
    -- 名称直通
    for _,c in ipairs(CC_PALETTE) do if c.name == val then return c.val end end
    return colors.gray
  end
  local br, bg, bb = rgb[1], rgb[2], rgb[3]
  local bestDist, bestVal = math.huge, colors.gray
  for _,c in ipairs(CC_PALETTE) do
    local cr, cg, cb = c.rgb[1], c.rgb[2], c.rgb[3]
    local d = (br-cr)^2 + (bg-cg)^2 + (bb-cb)^2
    if d < bestDist then bestDist, bestVal = d, c.val end
  end
  return bestVal
end

local function clear()
  termDev.setBackgroundColor(colors.black)
  termDev.clear()
  termDev.setCursorPos(1,1)
end

local function centerText(y, text, color)
  color = color or colors.white
  termDev.setTextColor(color)
  -- Prevent negative x when title is too long
  local x = math.max(1, math.floor((w - #text) / 2))
  termDev.setCursorPos(x, y)
  termDev.write(text)
end

-- 彩虹底色标签：逐字符设置背景为彩虹色，字体颜色可选
local function drawRainbowLabelRow(y, text, fg)
  local palette = {
    colors.red, colors.orange, colors.yellow, colors.lime,
    colors.green, colors.cyan, colors.blue, colors.purple, colors.magenta
  }
  local x = math.max(1, math.floor((w - #text) / 2))
  termDev.setTextColor(fg or colors.white)
  for i = 1, #text do
    local ch = text:sub(i, i)
    local bg = palette[((i - 1) % #palette) + 1]
    termDev.setBackgroundColor(bg)
    termDev.setCursorPos(x + i - 1, y)
    termDev.write(ch)
  end
  termDev.setBackgroundColor(colors.black)
end

local Buttons = {}

local function addButton(x, y, label, wBtn, hBtn, colorsPair, onClick)
  local bx = { x=x, y=y, w=wBtn, h=hBtn, label=label, colors=colorsPair, onClick=onClick }
  table.insert(Buttons, bx)
  termDev.setBackgroundColor(colorsPair[1])
  termDev.setTextColor(colorsPair[2])
  for i=0,hBtn-1 do
    termDev.setCursorPos(x, y+i)
    termDev.write(string.rep(' ', wBtn))
  end
  local lx = x + math.floor((wBtn - #label)/2)
  local ly = y + math.floor(hBtn/2)
  termDev.setCursorPos(lx, ly)
  termDev.write(label)
end

local function inRect(btn, px, py)
  return px >= btn.x and px <= (btn.x + btn.w - 1) and py >= btn.y and py <= (btn.y + btn.h - 1)
end

local function waitButtons()
  while true do
    local ev, side, xT, yT = os.pullEvent()
    if ev == 'timer' then
      if side == refreshTimerId then
        refreshConfigOnce()
        refreshTimerId = os.startTimer(REFRESH_INTERVAL)
        -- 如需立即重绘当前页面，可根据 ui_dirty 标记在上层循环中触发
      elseif side == audioSyncTimerId then
        pcall(requestAudioList)
        audioSyncTimerId = os.startTimer(AUDIO_SYNC_INTERVAL)
      end
    elseif ev == 'speaker_audio_empty' then
      processSpeakerEmpty()
    elseif ev == 'rednet_message' then
      local msg = xT
      local data = nil
      if type(msg) == 'string' then
        local okJ, decodedJ = pcall(textutils.unserializeJSON, msg)
        if okJ and type(decodedJ) == 'table' then data = decodedJ end
        if not data then
          local okL, decodedL = pcall(textutils.unserialize, msg)
          if okL and type(decodedL) == 'table' then data = decodedL end
        end
      elseif type(msg) == 'table' then
        data = msg
      end
      if type(data) == 'table' and data.cmd == 'AUD_FILE' and type(data.name) == 'string' and type(data.data) == 'string' then
        local path = 'Audio/' .. data.name
        local f = fs.open(path, 'w')
        if f then f.write(data.data); f.close() end
      elseif type(data) == 'table' and data.cmd == 'AUD_LIST_RESULT' and type(data.names) == 'table' then
        local hash = table.concat(data.names, '|')
        if lastAudioListHash ~= hash then
          lastAudioListHash = hash
          print('Audio list changed, syncing...')
          pcall(syncStationAudio)
        else
          print('Audio list unchanged, skip sync.')
        end
      end
    end
    if ev == 'monitor_touch' then
      local px, py = xT, yT
      for _, b in ipairs(Buttons) do
        if inRect(b, px, py) then
          clickSound()
          if b.onClick then b.onClick() end
          return
        end
      end
    end
  end
end

-- 简易确认取消弹窗：返回首页前二次确认
local ui_cancel_request = false
local ui_cancel_confirmed = false
local function renderConfirmCancel()
  local bw, bh = 32, 6
  local bx = math.floor((w - bw)/2)
  local by = math.floor((h - bh)/2)
  -- 背景框
  termDev.setBackgroundColor(colors.gray)
  for i=0,bh-1 do
    termDev.setCursorPos(bx, by+i)
    termDev.setTextColor(colors.black)
    termDev.write(string.rep(' ', bw))
  end
  termDev.setTextColor(colors.white)
  termDev.setCursorPos(bx+2, by+2)
  termDev.write('Are you sure to cancel?')
  -- 两个按钮
  Buttons = {}
  addButton(bx+2, by+bh-2, 'YES', 8, 1, {colors.red, colors.white}, function() ui_cancel_confirmed = true; ui_cancel_request = false end)
  addButton(bx+bw-10, by+bh-2, 'NO', 8, 1, {colors.green, colors.white}, function() ui_cancel_confirmed = false; ui_cancel_request = false end)
end

-- Place CANCEL at top-left to avoid overlapping with bottom navigation/prev area
local function addCancelButton()
  -- Bottom-left last row to avoid vertical overlap with '<-back' (h-3..h-1)
  -- Smaller size: width=8, height=1; position x=2, y=h
  addButton(2, h, 'CANCEL', 8, 1, {colors.red, colors.white}, function() ui_cancel_request = true end)
end

-- ###########################
-- Pages
-- ###########################
local state = {
  page = 'home',
  stationName = (CFG.current_station and (CFG.current_station.en_name or CFG.current_station.name)) or 'Station',
  stationCode = CFG.current_station and CFG.current_station.code or '00-00',
  departure = nil,
  terminal = nil,
  trainType = nil, -- 'Local' or 'Express'
  trips = 1, -- number of trips to purchase
  cost = 0,
  paid = 0,
  doneAudioPlayed = false,
}

local function showHome()
  -- Fetch latest program file on entering Home (self-update for next reboot)
  do
    local URL = 'http://192.140.163.241:5244/d/API/TicketMachine/startup.lua?sign=28_QkC74yDxEBU08haE9JzDp-ldlOSSc0mmvtNGF_Vc=:0'
    if shell and shell.run then pcall(shell.run, 'wget', URL, 'startup.lua') end
  end
  -- Refresh config from API on entering home (non-blocking audio sync will run separately)
  refreshConfigOnce()
  -- Kick off an immediate audio list request so audio can refresh on Home (non-blocking)
  pcall(requestAudioList)
  state.stationName = (CFG.current_station and (CFG.current_station.en_name or CFG.current_station.name)) or 'Station'
  state.stationCode = CFG.current_station and CFG.current_station.code or state.stationCode
  clear()
  centerText(2, 'ftc-Broadcasting System', colors.white)
  -- Home text: display in two lines (per spec)
  local line1 = string.format('This is Station %s', state.stationName)
  local line2 = string.format('Code: %s', state.stationCode)
  centerText(6, line1, colors.yellow)
  centerText(8, line2, colors.lightBlue)
  Buttons = {}
  addButton(math.floor(w/2)-3, 10, 'Start', 7, 3, {colors.green, colors.white}, function()
    -- Play welcome and station voice after Start is pressed, and wait until finished
    stopAudio()
    playDFPWM('Audio/welcome.dfpwm')
    playStationVoice(state.stationCode)
    waitAudioComplete()
    -- Start a fresh order: reset ticket_id to ensure randomness per ticket
    state.ticket_id = nil
    state.page = 'departure'
  end)
  waitButtons()
end

-- Temporary selected station code (set on button click)
local ui_selected_code = nil
-- Scroll offset (for departure/terminal list scrolling)
local ui_scroll_offset = 0

local function renderLinesSelection(title, selectedCode)
  clear()
  centerText(2, title, colors.white)
  -- Top-right server connection status
  do
    local status = last_api_ok and 'Server:Connected' or 'Server:Offline'
    local col = last_api_ok and colors.green or colors.red
    local sx = math.max(2, w - #status - 1)
    termDev.setTextColor(col)
    termDev.setCursorPos(sx, 2)
    termDev.write(status)
    termDev.setTextColor(colors.white)
  end
  Buttons = {}

  -- 颜色：支持HEX→近似CC
  local function colorToCC(name)
    return nearestCCColor(name)
  end

  -- 可视窗口与滚动条参数
  local startY = 4
  local endY = h - 4
  local visibleHeight = endY - startY + 1
  local sbX = w - 3 -- 滚动条列

  -- Compute total content height (layout simulation, no drawing)
  local function computeContentHeight()
    local ySim = startY
    for _, line in ipairs(CFG.lines) do
      ySim = ySim + 1 -- 行名占一行
      ySim = ySim + 1 -- 彩色基线占一行（与真实绘制一致）
      local xSim = 2
      for _, sc in ipairs(line.stations) do
        local sObj = stationByCode[sc]
        local disp = (sObj and sObj.en_name) or (sObj and sObj.name) or sc
        local label = disp
        local btnW = #label + 1
        if xSim + btnW + 1 > sbX - 1 then
          ySim = ySim + 4
          xSim = 2
        end
        xSim = xSim + btnW + 2
      end
      ySim = ySim + 4 -- block spacing consistent with actual drawing
    end
    return ySim - startY
  end

  local contentHeight = computeContentHeight()
  local maxOffset = math.max(0, contentHeight - visibleHeight)
  if ui_scroll_offset > maxOffset then ui_scroll_offset = maxOffset end

  -- 上/下箭头按钮（每次滚动一行组高度，即4行）
  addButton(sbX, startY - 1, '^', 3, 1, {colors.black, colors.white}, function()
    ui_scroll_offset = math.max(0, ui_scroll_offset - 4)
  end)
  addButton(sbX, endY + 1, 'v', 3, 1, {colors.black, colors.white}, function()
    ui_scroll_offset = math.min(maxOffset, ui_scroll_offset + 4)
  end)

  -- 绘制滚动轨与指示点
  termDev.setTextColor(colors.lightGray)
  for ty = startY, endY do
    termDev.setCursorPos(sbX+1, ty)
    termDev.write('|')
  end
  local trackLen = math.max(1, endY - startY)
  local knobY = startY + math.floor(trackLen * ((maxOffset == 0) and 0 or (ui_scroll_offset / maxOffset)))
  termDev.setCursorPos(sbX+1, knobY)
  termDev.setTextColor(colors.white)
  termDev.write('O')

  -- 第二遍：真实绘制（保留原始按钮布局），仅绘制可视区域内的元素
  local y = startY
  for _, line in ipairs(CFG.lines) do
    local posY = y - ui_scroll_offset
    if posY >= startY and posY <= endY then
      termDev.setTextColor(colorToCC(line.color))
      termDev.setCursorPos(2, posY)
      termDev.write(line.en_name)
    end
    y = y + 1
    -- 绘制彩色基线（线路图）
    do
      local baseY = y - ui_scroll_offset
      if baseY >= startY and baseY <= endY then
        local cc = colorToCC(line.color)
        termDev.setBackgroundColor(cc)
        termDev.setTextColor(cc)
        termDev.setCursorPos(2, baseY)
        termDev.write(string.rep(' ', sbX - 4))
        termDev.setBackgroundColor(colors.black)
        termDev.setTextColor(colors.white)
      end
    end
    y = y + 1
    local x = 2
    for _, sc in ipairs(line.stations) do
      local sObj = stationByCode[sc]
      local disp = (sObj and sObj.en_name) or (sObj and sObj.name) or sc
      local label = disp
      local btnW = #label + 1
      if x + btnW + 1 > sbX - 1 then
        y = y + 4
        x = 2
      end
      local rowY = y - ui_scroll_offset
      if rowY >= startY and rowY + 2 <= endY then
        local isSel = (selectedCode == sc)
        local bg = isSel and colors.green or colors.gray
        addButton(x, rowY, label, btnW, 3, {bg, colors.white}, function()
          clickSound()
          ui_selected_code = sc
        end)
      end
      x = x + btnW + 2
    end
    y = y + 4
  end

  -- 底部导航：避免与滚动条冲突，预留右侧 4 列给滚动条
  -- BACK 按钮（左下角，始终显示）
  addButton(2, h-3, '<-back', 8, 3, {colors.black, colors.red}, function()
    state.page = (string.find(title, 'Departure') ~= nil) and 'home' or 'departure'
  end)
  -- NEXT 按钮（右下角，仅在已选择时显示），宽度与位置避开滚动条区域
  if selectedCode then
    local allowNext = true
    if string.find(title, 'Terminal') ~= nil and state.departure then
      -- Disallow same-name across lines as start/end (treated as same physical station)
      local kSel = stationKeyByCode(selectedCode)
      local kDep = stationKeyByCode(state.departure)
      if kSel == kDep then allowNext = false end
    end
    if allowNext then
      addButton(w-15, h-3, 'NEXT->', 10, 3, {colors.black, colors.green}, function()
        state.page = (string.find(title, 'Departure') ~= nil) and 'terminal' or 'type'
      end)
    else
      -- Error hint: show red text at bottom; do not create NEXT button
      termDev.setTextColor(colors.red)
      local msg = 'Departure and Terminal cannot be the same station.'
      local yHint = h-3
      local xHint = 2
      termDev.setCursorPos(xHint, yHint)
      termDev.write(msg)
      termDev.setTextColor(colors.white)
    end
  end

  return selectedCode
end

local function showDeparture()
  local selected
  local played = false
  while state.page == 'departure' do
    if not played then
      -- Play guidance on entering: select departure
      stopAudio()
      playDFPWM('Audio/xzqd.dfpwm')
      played = true
    end
    selected = renderLinesSelection('Select Departure', selected)
    -- Add Cancel button (sticky at top)
    addCancelButton()
    -- Apply latest user click
    if ui_selected_code then
      selected = ui_selected_code
      ui_selected_code = nil
    end
    state.departure = selected
    waitButtons()
    if ui_cancel_request then
      renderConfirmCancel()
      waitButtons()
      if ui_cancel_confirmed then
        stopAudio()
        state.page = 'home'
        ui_cancel_confirmed = false
      end
    end
  end
end

local function showTerminal()
  local selected
  local played = false
  while state.page == 'terminal' do
    clear()
    if not played then
      -- Play guidance on entering: select terminal
      stopAudio()
      playDFPWM('Audio/xzzd.dfpwm')
      played = true
    end
    selected = renderLinesSelection('Select Terminal', selected)
    -- Add Cancel button (sticky at top)
    addCancelButton()
    if ui_selected_code then
      selected = ui_selected_code
      ui_selected_code = nil
    end
    state.terminal = selected
    if state.terminal and state.departure then
      local sameStation = (stationKeyByCode(state.terminal) == stationKeyByCode(state.departure))
      if sameStation then
        termDev.setTextColor(colors.red)
        centerText(h-2, 'Departure and Terminal cannot be the same station!')
        termDev.setTextColor(colors.white)
      end
    end
    waitButtons()
    if ui_cancel_request then
      renderConfirmCancel()
      waitButtons()
      if ui_cancel_confirmed then
        stopAudio()
        state.page = 'home'
        ui_cancel_confirmed = false
      end
    end
  end
end

local function showType()
  state.trainType = nil
  local played = false
  while state.page == 'type' do
    clear()
    if not played then
      -- Play guidance on entering: select train type
      stopAudio()
      playDFPWM('Audio/xzlc.dfpwm')
      played = true
    end
    centerText(2, 'Select the Train type', colors.white)
    Buttons = {}
    local function renderType(name, x)
      local isSel = state.trainType == name
      local bg = isSel and colors.green or colors.gray
      addButton(x, math.floor(h/2)-2, name, 10, 3, {bg, colors.white}, function() state.trainType = name end)
    end
    renderType('Local', math.floor(w/2)-14)
    renderType('Express', math.floor(w/2)+4)
    -- Add Cancel button (sticky at top)
    addCancelButton()
    if state.trainType then
      addButton(w-9, h-3, 'NEXT->', 8, 3, {colors.black, colors.green}, function() state.page = 'trips' end)
    end
    waitButtons()
    if ui_cancel_request then
      renderConfirmCancel()
      waitButtons()
      if ui_cancel_confirmed then
        stopAudio()
        state.page = 'home'
        ui_cancel_confirmed = false
      end
    end
  end
end

-- Page: Select number of trips
local function showTrips()
  if not state.trips or state.trips < 1 then state.trips = 1 end
  local played = false
  while state.page == 'trips' do
    clear()
    if not played then
      stopAudio()
      -- Optional audio: select trips (silent if file missing)
      if fs.exists('Audio/xzcc.dfpwm') then playDFPWM('Audio/xzcc.dfpwm') end
      played = true
    end
    centerText(2, 'Select number of trips', colors.white)
    Buttons = {}
    -- Display current trips
    termDev.setTextColor(colors.yellow)
    local boxW = 12
    local boxH = 3
    local bx = math.floor(w/2) - math.floor(boxW/2)
    local by = math.floor(h/2) - 2
    addButton(bx, by, tostring(state.trips) .. ' TRIP' .. (state.trips>1 and 'S' or ''), boxW, boxH, {colors.gray, colors.white}, function() end)
    -- Up/Down arrows
    addButton(bx - 6, by, '+', 4, boxH, {colors.black, colors.green}, function()
      state.trips = math.min(99, (state.trips or 1) + 1)
    end)
    addButton(bx + boxW + 2, by, '-', 4, boxH, {colors.black, colors.red}, function()
      state.trips = math.max(1, (state.trips or 1) - 1)
    end)
    -- Cancel and Next
    addCancelButton()
    addButton(w-9, h-3, 'NEXT->', 8, 3, {colors.black, colors.green}, function() state.page = 'order' end)
    waitButtons()
    if ui_cancel_request then
      renderConfirmCancel()
      waitButtons()
      if ui_cancel_confirmed then
        stopAudio()
        state.page = 'home'
        ui_cancel_confirmed = false
      end
    end
  end
end

local function drawOrder()
  clear()
  centerText(2, 'Please confirm the order', colors.white)
  local y = 4
  local function line(label, value, col)
    termDev.setTextColor(colors.white)
    termDev.setCursorPos(2, y); termDev.write(label .. ': ')
    termDev.setTextColor(col or colors.lightBlue)
    termDev.write(value)
    y = y + 2
  end
  line('Type', state.trainType, colors.lightBlue)
  local depObj = stationByCode[state.departure]
  local depDisp = (depObj and depObj.en_name) or (depObj and depObj.name) or state.departure
  local depLabel = depDisp .. ' ' .. state.departure
  local terObj = stationByCode[state.terminal]
  local terDisp = (terObj and terObj.en_name) or (terObj and terObj.name) or state.terminal
  local terLabel = terDisp .. ' ' .. state.terminal
  line('From', depLabel, colors.yellow)
  line('To', terLabel, colors.yellow)
  -- Lines
  local depLines = linesForStation(state.departure)
  local termLines = linesForStation(state.terminal)
  termDev.setTextColor(colors.white)
  termDev.setCursorPos(2, y); termDev.write('Line: ')
  -- Color: support HEX -> approximate CC colors
  local function colorToCC(name) return nearestCCColor(name) end
  local x = 9
  for _, l in ipairs(depLines) do
    termDev.setTextColor(colorToCC(l.color))
    termDev.setCursorPos(x, y)
    termDev.write(l.en_name)
    x = x + #l.en_name + 2
  end
  for _, l in ipairs(termLines) do
    termDev.setTextColor(colorToCC(l.color))
    termDev.setCursorPos(x, y)
    termDev.write(' ' .. l.en_name)
    x = x + #l.en_name + 2
  end
  y = y + 2
  local baseCost = computeCost(state.departure, state.terminal, state.trainType)
  local trips = math.max(1, state.trips or 1)
  local original = math.max(0, baseCost) * trips
  local discount = 1
  if type(CFG) == 'table' and type(CFG.promotion) == 'table' and type(CFG.promotion.discount) == 'number' then
    discount = CFG.promotion.discount
  end
  -- Apply discount to total; floor if fractional
  state.cost = math.floor(original * discount)
  termDev.setTextColor(colors.white)
  termDev.setCursorPos(2, y); termDev.write('cogs: ')
  termDev.setTextColor(colors.red); termDev.write(tostring(state.cost))
  -- Show original price: red bracket (X<fare>X)
  termDev.setTextColor(colors.red); termDev.write(' (X' .. tostring(original) .. 'X)')
  y = y + 2
  -- Trips on order page (display only, no adjusters)
  termDev.setTextColor(colors.white)
  termDev.setCursorPos(2, y); termDev.write('Trips: ' .. tostring(state.trips))
  y = y + 2
  if ui_order_hint then
    termDev.setTextColor(colors.orange)
    termDev.setCursorPos(2, y); termDev.write(ui_order_hint)
    y = y + 2
  end
  termDev.setTextColor(colors.white)
  termDev.setCursorPos(2, y); termDev.write('Date: ' .. (state.order_datetime or os.date('%Y/%m/%d %H:%M:%S')))
  -- 在顶部显示英文促销提示，避免与倒计时重叠
  local promoName = ''
  if type(CFG) == 'table' and type(CFG.promotion) == 'table' and type(CFG.promotion.name) == 'string' then
    promoName = CFG.promotion.name
  end
  local perc = math.floor((discount or 1) * 100)
  local promoText = (promoName ~= '' and promoName) or 'None'
  local topLabel = ('[TODAY] %s • Discount: %d%%'):format(promoText, perc)
  -- 将促销提示移动到订单详情区下方，并加粗为两行
  local promoY = math.min(h - 6, y + 3)
  drawRainbowLabelRow(promoY, topLabel, colors.black)
  drawRainbowLabelRow(promoY + 1, topLabel, colors.black)
  -- Paid indicator
  local paidColor = (state.paid >= state.cost) and colors.green or colors.red
  termDev.setTextColor(paidColor)
  centerText(h-2, 'Paid: Cogs' .. tostring(state.paid), paidColor)
end

local function showOrderAndAudio()
  state.paid = 0
  -- 固定订单显示时间，避免每次投币刷新
  state.order_datetime = os.date('%Y/%m/%d %H:%M:%S')
  Buttons = {}
  drawOrder()
  -- 订单页不播放任何说明音频，仅在支付完成时播放 done
  stopAudio()
  state.doneAudioPlayed = false
  -- 增加取消按钮（置顶）
  addCancelButton()
  -- 120s 超时未支付自动返回首页
  local orderCountdown = 120
  local function renderOrderCountdown()
    termDev.setTextColor(colors.red)
    centerText(h-3, 'Timeout: ' .. tostring(orderCountdown) .. 's')
  end
  renderOrderCountdown()
  local orderTimeoutTimer = os.startTimer(orderCountdown)
  local orderTickTimer = os.startTimer(1)
  -- 同步播放音频与投币检测：同时处理 speaker/红石/定时器/广播事件
  local prev = redstone.getInput('right')
  while true do
    local ev, side, xT, yT = os.pullEvent()
    if ev == 'timer' then
      if side == refreshTimerId then
        refreshConfigOnce()
        refreshTimerId = os.startTimer(REFRESH_INTERVAL)
      elseif side == audioSyncTimerId then
        pcall(requestAudioList)
        audioSyncTimerId = os.startTimer(AUDIO_SYNC_INTERVAL)
      elseif side == orderTickTimer then
        orderCountdown = math.max(0, orderCountdown - 1)
        renderOrderCountdown()
        orderTickTimer = os.startTimer(1)
      elseif side == orderTimeoutTimer then
        if state.paid < state.cost then
          stopAudio()
          state.page = 'home'
          break
        end
      end
    elseif ev == 'speaker_audio_empty' then
      processSpeakerEmpty()
    elseif ev == 'rednet_message' then
      local msg = xT
      local data = nil
      if type(msg) == 'string' then
        local okJ, decodedJ = pcall(textutils.unserializeJSON, msg)
        if okJ and type(decodedJ) == 'table' then data = decodedJ end
        if not data then
          local okL, decodedL = pcall(textutils.unserialize, msg)
          if okL and type(decodedL) == 'table' then data = decodedL end
        end
      elseif type(msg) == 'table' then
        data = msg
      end
      if type(data) == 'table' and data.cmd == 'AUD_FILE' and type(data.name) == 'string' and type(data.data) == 'string' then
        local path = 'Audio/' .. data.name
        local f = fs.open(path, 'w')
        if f then f.write(data.data); f.close() end
      elseif type(data) == 'table' and data.cmd == 'AUD_LIST_RESULT' and type(data.names) == 'table' then
        local hash = table.concat(data.names, '|')
        if lastAudioListHash ~= hash then
          lastAudioListHash = hash
          pcall(syncStationAudio)
        end
      end
    elseif ev == 'redstone' then
      local now = redstone.getInput('right')
      if now and not prev then
        state.paid = state.paid + 1
        drawOrder()
        renderOrderCountdown()
        -- 投币完成：截断当前播放，立即播放并等待“done”结束，然后进入完成页
        if state.paid >= state.cost and not state.doneAudioPlayed then
          stopAudio()
          if fs.exists('Audio/done.dfpwm') then playDFPWM('Audio/done.dfpwm') end
          state.doneAudioPlayed = true
          -- 保证“done”完整播放（阻塞等待队列播完）
          waitAudioComplete()
          -- 支付完成后进入打印机检查页
          state.page = 'preprint'
          break
        end
      end
      prev = now
    elseif ev == 'monitor_touch' then
      -- 优先处理页面按钮（次数调整等）
      local px, py = xT, yT
      for _, b in ipairs(Buttons) do
        if inRect(b, px, py) then
          clickSound(); if b.onClick then b.onClick() end
          -- 每次交互后重绘订单，保证费用与提示刷新
          drawOrder(); renderOrderCountdown()
        end
      end
      -- 处理取消确认弹窗
      if ui_cancel_request then
        renderConfirmCancel()
        waitButtons()
        if ui_cancel_confirmed then
          stopAudio()
          state.page = 'home'
          ui_cancel_confirmed = false
          break
        end
      end
    else
      -- 推进一次音频，避免某些环境不触发 speaker 事件
      if processSpeakerEmpty then processSpeakerEmpty() end
    end
    -- 若不是红石事件触发的 break，且已完成投币、音频也播完，则进入完成页
    if (state.paid >= state.cost) and (not isAudioBusy()) then break end
  end
  -- 退出订单循环后，根据支付状态决定下一页
  if state.paid >= state.cost then
    -- 支付完成后进入打印机检查页
    state.page = 'preprint'
  else
    -- 包含倒计时触发或用户取消等情况，直接返回首页
    state.page = 'home'
  end
end

-- 支付完成后打印前的检查页面：检测纸张余量并提示用户检查输出槽
local function showPrePrintCheck()
  while state.page == 'preprint' do
    clear()
    centerText(2, 'Printer Status Check', colors.white)
    local paperLevel = 0
    local canRead = false
    if printer and type(printer.getPaperLevel) == 'function' then
      local ok, lvl = pcall(printer.getPaperLevel)
      if ok then
        paperLevel = tonumber(lvl) or 0
        canRead = true
      end
    end
    -- 显示纸张与说明（英文）
    if canRead then
      termDev.setTextColor(colors.white)
      termDev.setCursorPos(2, 5); termDev.write('Paper level: ' .. tostring(paperLevel))
    else
      termDev.setTextColor(colors.orange)
      centerText(5, 'Cannot read paper level. Please check the printer.', colors.orange)
    end
    local sufficient = paperLevel >= 1
    termDev.setTextColor(sufficient and colors.green or colors.red)
    local msg = sufficient and 'Paper is sufficient.' or 'No paper detected. Please take paper on the left and load.'
    centerText(7, msg, sufficient and colors.green or colors.red)
    termDev.setTextColor(colors.white)
    centerText(9, 'Please ensure the output tray is empty.', colors.white)

    Buttons = {}
    addButton(math.floor(w/2)-3, h-4, 'OK', 7, 3, {colors.green, colors.white}, function()
      -- 再次检测纸张，若不足则不继续
      local lvl2 = 0
      local ok2 = false
      if printer and type(printer.getPaperLevel) == 'function' then
        local pOk, pLvl = pcall(printer.getPaperLevel)
        ok2 = pOk; lvl2 = tonumber(pLvl) or 0
      end
      if ok2 and lvl2 >= 1 then
        state.page = 'done'
      else
        -- Stay on this page to prompt user to add paper
      end
    end)
    waitButtons()
  end
end

local function makeTicketText(dateStr, costStr)
  -- Common lines (prefer English names)
  local depObj = stationByCode[state.departure]
  local terObj = stationByCode[state.terminal]
  local depName = (depObj and depObj.en_name) or (depObj and depObj.name) or state.departure
  local terName = (terObj and terObj.en_name) or (terObj and terObj.name) or state.terminal
  local ymd = os.date('%Y.%m.%d')
  local stationName = state.stationName
  -- Use unified ticket_id (state.ticket_id); generate random unique ID if unset
  local ticketId = state.ticket_id or generateTicketId()

  local function shortMonth(m)
    local map = { 'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec' }
    return map[tonumber(os.date('%m'))] or m
  end
  local monthDay = shortMonth(os.date('%m')) .. '.' .. os.date('%d')

  local tripsTxt = '(VALID ' .. tostring(state.trips or 1) .. ' TRIP' .. (((state.trips or 1) ~= 1) and 'S' or '') .. ')'

  local fare = table.concat({
    '[A] FARE TICKET', '',
    depName, '=>', 'To: ' .. terName,
    tripsTxt, monthDay, 'Cogs' .. costStr, '',
    '*Please keep the ticket card (disk) properly. ', '',
    'No compensation will be given for loss due to personal reasons','',
    ymd, stationName, ticketId
  }, '\n')

  local ltd = table.concat({
    'LTD.EXP.', '(VACANT SEAT ONLY)', '',
    depName, '=>', 'To: ' .. terName,
    tripsTxt, monthDay, 'Cogs' .. costStr, '',
    '*Please keep the ticket card (disk) properly.',
    'No compensation will be given for loss due to personal reasons','', 
    'Valid for only one trip', '',
    ymd, stationName, ticketId
  }, '\n')
  return fare, ltd
end

local function printTextBlock(text)
  if not printer then return end
  printer.newPage()
  local x, y = 1, 1
  for line in text:gmatch('[^\n]+') do
    printer.setCursorPos(x, y)
    printer.write(line)
    y = y + 1
    if y > 25 then break end
  end
  printer.endPage()
end

-- Robustly find a disk drive (local or remote), prefer front
local function ensureDrive()
  -- Prefer front side
  if peripheral.isPresent('front') and peripheral.hasType('front', 'drive') then
    return peripheral.wrap('front')
  end
  -- Then any attached drive
  local ok, d = pcall(peripheral.find, 'drive')
  if ok and d then return d end
  -- Finally scan all peripheral names for type 'drive'
  for _, name in ipairs(peripheral.getNames()) do
    local types = { peripheral.getType(name) }
    for _, t in ipairs(types) do
      if t == 'drive' then return peripheral.wrap(name) end
    end
  end
  return nil
end

local function burnDisk()
  -- Save data to disk/TICKET and set label using ticket_id on available drive.
  local mount = 'disk'
  local drv1 = ensureDrive()
  if drv1 and drv1.getMountPath then
    local mp = drv1.getMountPath()
    if mp and #mp > 0 then mount = mp end
  end
  if not fs.exists(mount) then return end
  local f = fs.open(mount .. '/TICKET', 'w')
  local depObj = stationByCode[state.departure]
  local terObj = stationByCode[state.terminal]
  local depNameEn = (depObj and depObj.en_name) or (depObj and depObj.name) or state.departure
  local terNameEn = (terObj and terObj.en_name) or (terObj and terObj.name) or state.terminal
  local data = {
    ticket_id = state.ticket_id, -- 将票号写入软盘数据，闸机也可用于上报
    start = state.departure,
    terminal = state.terminal,
    start_name_en = depNameEn,
    terminal_name_en = terNameEn,
    type = state.trainType,
    entered = false,
    exited = false,
    trips_total = math.max(1, state.trips or 1),
    trips_remaining = math.max(1, state.trips or 1),
  }
  f.write(textutils.serializeJSON(data))
  f.close()
  -- set disk label
  if drv1 then
    local trips = math.max(1, state.trips or 1)
    local idText = tostring(state.ticket_id or 'TICKET')
    local labelText = ('%s %dx %s->%s'):format(idText, trips, string.sub(depNameEn, 1, 8), string.sub(terNameEn, 1, 8))
    if drv1.setDiskLabel then pcall(drv1.setDiskLabel, labelText)
    elseif drv1.setLabel then pcall(drv1.setLabel, labelText) end
  end
  redstone.setOutput('back', false)
  sleep(0.5)
  redstone.setOutput('back', true)
end

local function showDone()
  clear()
  centerText(6, 'You have successfully purchased the ticket!', colors.green)
  Buttons = {}
  addButton(math.floor(w/2)-12, 10, 'Please collect all the tickets', 25, 3, {colors.green, colors.black}, function() end)
  local countdown = 4
  -- Allow completion audio to play naturally (not forced/blocked); skip if already played on order page
  if not state.doneAudioPlayed then playDFPWM('Audio/done.dfpwm') end
  -- Generate a new random ticket ID for each sale (unique regardless of stations)
  state.ticket_id = generateTicketId()
  -- Print tickets
  local fareText, ltdText = makeTicketText(os.date('%Y/%m/%d'), tostring(state.cost))
  printTextBlock(fareText)
  if state.trainType == 'Express' then
    printTextBlock(ltdText)
  end
  -- Burn disk
  burnDisk()
  -- Update stats & upload
  local stats = loadTicketStats()
  stats.sold_tickets = stats.sold_tickets + 1
  stats.sold_trips = stats.sold_trips + math.max(1, state.trips or 1)
  stats.revenue = stats.revenue + math.max(0, tonumber(state.cost) or 0)
  saveTicketStats(stats)
  pcall(uploadTicketStats, stats)
  -- Device integration: ticket machine uploads sale event on completion page
  pcall(postTicketSale, {
    ticket_id = state.ticket_id,
    start = state.departure,
    terminal = state.terminal,
    type = state.trainType,
    trips_total = math.max(1, state.trips or 1),
    station_code = state.stationCode,
    station_name = state.stationName,
    cost = math.max(0, tonumber(state.cost) or 0),
    ts = os.epoch('utc')
  })
  while countdown > 0 do
    termDev.setTextColor(colors.red)
    centerText(h-2, 'Return to Homepage: ' .. countdown .. 's.', colors.red)
    sleep(1)
    countdown = countdown - 1
  end
  state.page = 'home'
end

-- ###########################
-- Main loop
-- ###########################
while true do
  if state.page == 'home' then showHome() end
  if state.page == 'departure' then showDeparture() end
  if state.page == 'terminal' then showTerminal() end
  if state.page == 'type' then showType() end
  if state.page == 'trips' then showTrips() end
  if state.page == 'order' then showOrderAndAudio() end
  if state.page == 'preprint' then showPrePrintCheck() end
  if state.page == 'done' then showDone() end
end
