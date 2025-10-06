--[[
Author: error: error: git config user.name & please set dead value or install git && error: git config user.email & please set dead value or install git & please set dead value or install git
Date: 2025-10-03 22:33:53
LastEditors: error: error: git config user.name & please set dead value or install git && error: git config user.email & please set dead value or install git & please set dead value or install git
LastEditTime: 2025-10-06 09:18:38
FilePath: \TicketMachine\gate.lua
Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
--]]
-- FTC Ticketing System – Gate
-- Runtime: CC:Tweaked (ComputerCraft)
-- Purpose: Read floppy TICKET, validate entry/exit, drive redstone and audio
-- Configuration: CURRENT_STATION_CODE; GATE_TYPE (0=entry, 1=exit)
-- Comment style: concise, consistent English for open-source
-- MADE BY Henry_Du henrydu@henrycloud.ink 

local CURRENT_STATION_CODE = '01-01'
-- Gate type: 0=entry, 1=exit
local GATE_TYPE = 0
-- After PASS, keep top redstone ON for N seconds
local PASS_TOP_ON_SECONDS = 3
-- Periodic self-update (every 10 minutes)
local UPDATE_URL = 'http://192.140.163.241:5244/d/API/TicketMachine/gate.lua?sign=OWy1wKkKhUhpnxXKeX6fRLePSg1XcaQgWOLvQbMuHRQ=:0'
-- ftc Ticket Gate - ComputerCraft (CC: Tweaked)
-- Ticket checking system which reads a floppy's TICKET file
-- and decides pass/fail, driving redstone and audio accordingly.
-- All UI text and comments are in English.

-- Peripherals
local monitor = peripheral.find('monitor')
local speaker = peripheral.find('speaker')

-- Station configuration (EDIT THIS): set your station code here.
-- All checks below use this code to compare with ticket's start station
-- and to validate terminal station existence in StationList.txt.

-- Support multiple station codes for the same station, separated by '/'
-- Example: "01-01/03-06/04-05" means these codes are considered equal here
local function buildStationCodeSet(codeStr)
  local set = {}
  if type(codeStr) ~= 'string' then return set end
  -- strip BOM and spaces
  local s = codeStr:gsub('[\239\187\191]', '')
  for part in s:gmatch('[^/]+') do
    local c = part:gsub('%s+', '')
    if #c > 0 then set[c] = true end
  end
  return set
end

-- Stats (gate): entries/exits and optional upload
local GATE_STATS_PATH = 'logs/gate_stats.json'
local API_ENDPOINT_GATE_PATH = 'API_ENDPOINT_GATE.txt'
local function ensureDir(path)
  local dir = path:match('^(.+)/[^/]+$')
  if dir and not fs.exists(dir) then pcall(fs.makeDir, dir) end
end
local function readFile(path)
  if not fs.exists(path) then return nil end
  local f = fs.open(path, 'r'); local c = f.readAll(); f.close(); return c
end
local function writeFile(path, content)
  local f = fs.open(path, 'w'); if not f then return false end; f.write(content); f.close(); return true
end
local function loadGateStats()
  local def = { entries = 0, exits = 0 }
  if not fs.exists(GATE_STATS_PATH) then return def end
  local ok, data = pcall(textutils.unserializeJSON, readFile(GATE_STATS_PATH) or '')
  if ok and type(data) == 'table' then
    for k, v in pairs(def) do if type(data[k]) ~= 'number' then data[k] = v end end
    return data
  end
  return def
end
local function saveGateStats(stats)
  ensureDir(GATE_STATS_PATH)
  local ok, s = pcall(textutils.serializeJSON, stats)
  if not ok or type(s) ~= 'string' then s = textutils.serialize(stats) end
  writeFile(GATE_STATS_PATH, s)
end

-- Debug logger: write diagnostic info to logs/gate_debug.jsonl
local function debugLog(tag, data)
  local path = 'logs/gate_debug.jsonl'
  ensureDir(path)
  local payload = { tag = tostring(tag or ''), ts = os.epoch('utc'), data = data }
  local ok, line = pcall(textutils.serializeJSON, payload)
  if not ok or type(line) ~= 'string' then line = textutils.serialize(payload) end
  local f = fs.open(path, 'a'); if f then f.write(line .. "\n"); f.close() end
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
local function uploadGateStats(stats)
  local url = readApiEndpoint(API_ENDPOINT_GATE_PATH)
  if not url or not http or not http.post then return false end
  local window_hour = os.date('%Y%m%d%H')
  local window_day = os.date('%Y%m%d')
  local bodyOk, body = pcall(textutils.serializeJSON, {
    device = 'gate',
    station_code = CURRENT_STATION_CODE,
    entries = stats.entries,
    exits = stats.exits,
    ts = os.epoch('utc'),
    window_hour = window_hour,
    window_day = window_day,
  })
  if not bodyOk then return false end
  local ok, res = pcall(http.post, url, body, { ['Content-Type'] = 'application/json' })
  if ok and res then res.close() end
  return ok
end

-- 上传票务状态：进站/出站
local function postTicketStatus(action, data, tripsRemain)
  local base = readApiEndpoint(API_ENDPOINT_GATE_PATH) or readApiEndpoint('API_ENDPOINT.txt') or ''
  if (not http or not http.post) or base == '' then return false end
  local url = (base:match('/api$') and base or (base .. '/api')) .. '/tickets/status'
  local id = tostring(data.ticket_id or data.id or '')
  if #id == 0 then return false end
  local payload = {
    ticket_id = id,
    action = tostring(action or ''),
    station_code = CURRENT_STATION_CODE,
    ts = os.epoch('utc'),
  }
  if tripsRemain ~= nil then payload.trips_remaining = tonumber(tripsRemain) end
  local okBody, body = pcall(textutils.serializeJSON, payload)
  if not okBody then return false end
  local ok, res = pcall(http.post, url, body, { ['Content-Type'] = 'application/json' })
  if ok and res then res.close() end
  return ok
end


-- Prefer the nearest drive (front if present)
local function ensureDrive(side)
  if side and peripheral.isPresent(side) and peripheral.hasType(side, 'drive') then
    return peripheral.wrap(side)
  end
  if peripheral.isPresent('front') and peripheral.hasType('front', 'drive') then
    return peripheral.wrap('front')
  end
  local ok, d = pcall(peripheral.find, 'drive')
  if ok and d then return d end
  return nil
end

-- Basic term wrapper for monitor
local function safe(term)
  if monitor then return peripheral.wrap(peripheral.getName(monitor)) end
  return term
end
local termDev = safe(term)
-- 先设置文本缩放，再测量尺寸，避免首次启动界面错位
if monitor then pcall(monitor.setTextScale, 0.5) end
local w, h = termDev.getSize()

-- Buttons
local Buttons = {}
local function clear()
  termDev.setBackgroundColor(colors.black)
  termDev.clear()
  termDev.setCursorPos(1,1)
end
local function centerText(y, text, color)
  color = color or colors.white
  termDev.setTextColor(color)
  local x = math.max(1, math.floor((w - #text)/2))
  termDev.setCursorPos(x, y)
  termDev.write(text)
end
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
    local ev, a, b, c = os.pullEvent()
    if ev == 'monitor_touch' then
      for _, bt in ipairs(Buttons) do
        if inRect(bt, b, c) then if bt.onClick then bt.onClick() end; return end
      end
    elseif ev == 'timer' or ev == 'disk' or ev == 'disk_eject' or ev == 'redstone' then
      return ev, a, b, c
    end
  end
end

-- Idle redstone: front ON while waiting; top OFF
local function setIdleRS()
  redstone.setOutput('front', true)
  redstone.setOutput('top', false)
end
setIdleRS()

-- Station list management
local STATION_LIST_PATH = 'StationList.txt'
local STATION_LIST_URL = 'http://192.140.163.241:5244/d/API/TicketMachine/StationList.txt?sign=aB0Wmi1cb68DOim-JjUL_07jhy9qJtQNoXtH_LbuxMs=:0'
local stationSet = {}
local function parseStationList()
  stationSet = {}
  if not fs.exists(STATION_LIST_PATH) then return end
  -- StationList.txt: one station code per line (e.g. 01-06)
  -- Trim whitespace and possible UTF-8 BOM to be safe.
  for line in io.lines(STATION_LIST_PATH) do
    local raw = tostring(line or '')
    local s = raw:gsub('[\239\187\191]', ''):gsub('%s+', '')
    if #s > 0 then stationSet[s] = true end
  end
end
local function updateStationList()
  -- Try wget first, then fall back to http.get
  if shell and shell.run then
    pcall(fs.delete, STATION_LIST_PATH)
    local ok = pcall(shell.run, 'wget', STATION_LIST_URL, STATION_LIST_PATH)
    if ok then parseStationList(); return end
  end
  if http and http.get then
    local ok, res = pcall(http.get, STATION_LIST_URL)
    if ok and res then
      local data = res.readAll(); res.close()
      local f = fs.open(STATION_LIST_PATH, 'w')
      if f then f.write(data); f.close() end
      parseStationList(); return
    end
  end
end
parseStationList()
local stationTimer = os.startTimer(120) -- periodically refresh
local updateTimer = os.startTimer(600)  -- periodically self-update

-- Screens
local function screenOpen()
  clear()
  centerText(3, 'ftc Ticket System', colors.yellow)
  Buttons = {}
  local function clampButtonY(y, height)
    return math.max(2, math.min(h - height, y))
  end
  local yOpen = clampButtonY(math.floor(h * 0.7), 2)
  addButton(math.floor(w/2)-4, yOpen, 'OPEN', 8, 2, {colors.yellow, colors.white}, function() end)
end

local function screenDetails(dataText)
  clear()
  centerText(2, 'Ticket Details', colors.white)
  termDev.setTextColor(colors.lightGray)
  local y = 4
  for line in dataText:gmatch('[^\n]+') do
    termDev.setCursorPos(2, y); termDev.write(line)
    y = y + 1
    if y > h-4 then break end
  end
end

local function screenPass()
  clear()
  centerText(4, 'ThankYou', colors.green)
  Buttons = {}
  local function clampButtonY(y, height)
    return math.max(2, math.min(h - height, y))
  end
  local yOk = clampButtonY(math.floor(h * 0.8), 2)
  addButton(math.floor(w/2)-4, yOk, 'OK', 8, 2, {colors.green, colors.white}, function() end)
end

local function screenFail(reason)
  clear()
  centerText(3, 'Sorry', colors.red)
  termDev.setTextColor(colors.red)
  -- Wrap reason across multiple centered lines
  local function wrapCenterText(yStart, text, color, maxLines)
    local maxWidth = math.max(8, w - 2)
    local lines = {}
    local i = 1
    while i <= #text and (#lines < (maxLines or 3)) do
      table.insert(lines, text:sub(i, i + maxWidth - 1))
      i = i + maxWidth
    end
    for idx, ln in ipairs(lines) do
      centerText(yStart + (idx - 1), ln, color)
    end
    return yStart + #lines - 1
  end
  local reasonTop = math.max(6, math.floor(h * 0.42))
  local lastReasonY = wrapCenterText(reasonTop, tostring(reason or ''), colors.red, 3)
  Buttons = {}
  -- Place NO near bottom, clamp to avoid going off-screen, and make smaller
  local function clampButtonY(y, height)
    return math.max(2, math.min(h - height, y))
  end
  local yNo = clampButtonY(math.max(lastReasonY + 2, math.floor(h * 0.8)), 2)
  addButton(math.floor(w/2)-4, yNo, 'NO', 8, 2, {colors.red, colors.white}, function() end)
end

-- Audio helpers (optional)
local function playIfExists(path)
  if not speaker then return end
  if fs.exists(path) then
    local dfpwm = require('cc.audio.dfpwm')
    local decoder = dfpwm.make_decoder()
    for chunk in io.lines(path, 16 * 1024) do
      local buffer = decoder(chunk)
      while not speaker.playAudio(buffer) do os.pullEvent('speaker_audio_empty') end
    end
  end
end

local function markEnteredYes(path, data)
  data.entered = "yes"
  data.exited = "no"
  local okSer, contentNew = pcall(textutils.serializeJSON, data)
  if not okSer or type(contentNew) ~= 'string' then
    contentNew = textutils.serialize(data)
  end
  local f = fs.open(path, 'w')
  if f then f.write(contentNew); f.close() end
end

local function markExitedNo(path, data)
  data.entered = "no"
  data.exited = "yes"
  local okSer, contentNew = pcall(textutils.serializeJSON, data)
  if not okSer or type(contentNew) ~= 'string' then
    contentNew = textutils.serialize(data)
  end
  local f = fs.open(path, 'w')
  if f then f.write(contentNew); f.close() end
end

local function exitAndDecrementTrips(drv, path, data)
  local remain = tonumber(data.trips_remaining) or tonumber(data.trips_total) or 1
  remain = math.max(0, remain - 1)
  data.trips_remaining = remain
  data.entered = "no"
  data.exited = "yes"
  local okSer, contentNew = pcall(textutils.serializeJSON, data)
  if not okSer or type(contentNew) ~= 'string' then
    contentNew = textutils.serialize(data)
  end
  local f = fs.open(path, 'w')
  if f then f.write(contentNew); f.close() end
  -- 小延时，确保文件写入完成再更新标签
  sleep(0.2)
  -- 更新软盘标签中的票数与票号
  if drv then
    local sName = tostring(data.start_name_en or data.start or '')
    local tName = tostring(data.terminal_name_en or data.terminal or '')
    local idText = tostring(data.ticket_id or data.id or 'TICKET')
    local labelText = ('%s %dx %s->%s'):format(idText, remain, string.sub(sName, 1, 8), string.sub(tName, 1, 8))
    if drv.setDiskLabel then pcall(drv.setDiskLabel, labelText)
    elseif drv.setLabel then pcall(drv.setLabel, labelText) end
    -- 多程票（仍有余次）自动弹出软盘，避免等待人工取出
    if remain > 0 then
      if drv.ejectDisk then pcall(drv.ejectDisk)
      elseif drv.eject then pcall(drv.eject) end
    end
  end
  return remain
end

local function handleDiskInsert(side)
  local drv = ensureDrive(side)
  if not drv or not drv.isDiskPresent or not drv.isDiskPresent() then
    screenFail('Not a floppy disk')
    waitButtons(); setIdleRS(); screenOpen(); return
  end
  if drv.hasAudio and drv.hasAudio() then
    -- Music disc -> not a floppy
    screenFail('Not a floppy disk')
    waitButtons(); setIdleRS(); screenOpen(); return
  end
  if not (drv.hasData and drv.hasData()) then
    screenFail('Not a floppy disk')
    waitButtons(); setIdleRS(); screenOpen(); return
  end
  -- Read ticket data JSON from disk/TICKET
  local mount = drv.getMountPath and drv.getMountPath() or 'disk'
  local path = mount .. '/TICKET'
  if not fs.exists(path) then
    screenFail('Ticket file missing')
    waitButtons(); setIdleRS(); screenOpen(); return
  end
  local f = fs.open(path, 'r')
  local content = f.readAll(); f.close()
  screenDetails(content)
  -- Parse JSON
  local data = nil
  local ok, decoded = pcall(textutils.unserializeJSON, content)
  if ok then data = decoded end
  if type(data) ~= 'table' then
    screenFail('Invalid ticket data')
    waitButtons(); setIdleRS(); screenOpen(); return
  end
  -- Normalize ticket codes: strip BOM and whitespace; be robust to key renames
  local function normalizeCode(s)
    s = tostring(s or '')
    s = s:gsub('[\239\187\191]', ''):gsub('%s+', '')
    return s
  end
  local function firstNonNil(tbl, keys)
    for _, k in ipairs(keys) do
      local v = tbl[k]
      if v ~= nil then return v end
    end
    return nil
  end
  local startCode = normalizeCode(firstNonNil(data, {'start','start_code','startStation','start_station'}))
  local terminalCode = normalizeCode(firstNonNil(data, {'terminal','terminal_code','terminalStation','terminal_station'}))
  -- entered/exited may be boolean, string, or number; parse gracefully
  local function parseBool(v)
    if type(v) == 'boolean' then return v end
    if type(v) == 'number' then return v ~= 0 end
    local s = tostring(v or ''):lower()
    return (s == 'yes' or s == 'true' or s == '1')
  end
  local hasEntered = parseBool(data.entered)
  local isUnlimited = (startCode == '*' and terminalCode == '*')

  -- Check rules using configured station code
  -- Prefer external config file if present and non-empty; otherwise use built-in
  local thisStation = CURRENT_STATION_CODE
  if fs.exists('CURRENT_STATION.txt') then
    local cf = fs.open('CURRENT_STATION.txt', 'r')
    local tmp = cf.readAll() or ''
    cf.close()
    tmp = tmp:gsub('[\239\187\191]', ''):gsub('%s+', '')
    if #tmp > 0 then thisStation = tmp end
  end

  local terminalExists = stationSet[terminalCode] == true
  local startSet = buildStationCodeSet(thisStation)
  local startMatches = (startSet[startCode] == true)
  -- 要求出站时到达站必须与当前车站一致（支持同站多个代码）
  local terminalMatchesCurrent = (startSet[terminalCode] == true)
  local tripsRemaining = tonumber(data.trips_remaining) or tonumber(data.trips_total) or 1

  -- Debug snapshot for diagnosis
  do
    local setKeys = {}
    for k, _ in pairs(startSet) do table.insert(setKeys, k) end
    debugLog('gate_check', {
      startCode = startCode,
      terminalCode = terminalCode,
      currentStation = thisStation,
      startSet = setKeys,
      startMatches = startMatches,
      terminalExists = terminalExists,
      terminalMatchesCurrent = terminalMatchesCurrent,
      hasEntered = hasEntered,
      gateType = GATE_TYPE,
      tripsRemaining = tripsRemaining,
    })
  end

  local passEntry = ((GATE_TYPE == 0) and ((isUnlimited and (not hasEntered)) or (startMatches and terminalExists and (not hasEntered) and (tripsRemaining > 0))))
  -- 出站：非通票必须满足到达站与当前站一致（不要求起点等于当前站）
  local passExit  = ((GATE_TYPE == 1) and ((isUnlimited and hasEntered) or (terminalExists and terminalMatchesCurrent and hasEntered)))
  if passEntry or passExit then
    debugLog('gate_pass', { gateType = GATE_TYPE, start = startCode, terminal = terminalCode })
    -- PASS: set top on, front off; play pass audio
    redstone.setOutput('top', true)
    redstone.setOutput('front', false)
    playIfExists('Audio/pass.dfpwm')
    screenPass()
    -- 门控策略：
    -- 进站或单程票：按固定延时关闭上方红石；
    -- 多程票：保持开门，待玩家取走软盘后延时2秒再关门。
    local remain = nil
    local totalTrips = tonumber(data.trips_total) or tonumber(data.trips_remaining) or 1
    if GATE_TYPE == 0 then
      -- 进站：通票仅标记 entered，不扣次数
      markEnteredYes(path, data)
      -- 上传进站状态
      pcall(postTicketStatus, 'enter', data, tonumber(data.trips_remaining) or tonumber(data.trips_total) or 1)
      if PASS_TOP_ON_SECONDS and PASS_TOP_ON_SECONDS > 0 then sleep(PASS_TOP_ON_SECONDS) end
      redstone.setOutput('top', false)
  else
      if isUnlimited then
        markExitedNo(path, data)
        -- 上传出站状态（通票不扣次）
        local remainUnlimited = tonumber(data.trips_remaining) or tonumber(data.trips_total) or 1
        pcall(postTicketStatus, 'exit', data, remainUnlimited)
        -- 通票：更新状态后直接弹出软盘，避免人工取盘
        if drv then
          if drv.ejectDisk then pcall(drv.ejectDisk)
          elseif drv.eject then pcall(drv.eject) end
        end
        remain = tonumber(data.trips_remaining) or tonumber(data.trips_total) or 1
      else
        remain = exitAndDecrementTrips(drv, path, data)
        -- 上传出站状态（普通票扣次后上报剩余）
        pcall(postTicketStatus, 'exit', data, remain)
      end
      if remain and remain > 0 then
        -- 仍有余次：前方红石保持 ON；若已自动弹出，则直接延时关门；否则等待弹出事件，最多2秒
        redstone.setOutput('front', true)
        local alreadyEjected = (drv and drv.isDiskPresent and (not drv.isDiskPresent()))
        if alreadyEjected then
          sleep(2)
        else
          local t = os.startTimer(2)
          while true do
            local evE, aE = os.pullEvent()
            if evE == 'disk_eject' then
              break
            elseif evE == 'timer' and aE == t then
              break
            end
          end
        end
        redstone.setOutput('top', false)
      else
        -- 用尽（最后一次）：直接开门（已开）并停止前方红石；按固定延时关门
        redstone.setOutput('front', false)
        if PASS_TOP_ON_SECONDS and PASS_TOP_ON_SECONDS > 0 then sleep(PASS_TOP_ON_SECONDS) end
        redstone.setOutput('top', false)
      end
      -- 前方红石：剩余次数>0则ON，否则OFF（已在分支中设置，这里保持一致）
      if remain and remain > 0 then redstone.setOutput('front', true) else redstone.setOutput('front', false) end
    end
    -- 更新统计
    local stats = loadGateStats()
    if GATE_TYPE == 0 then stats.entries = stats.entries + 1 else stats.exits = stats.exits + 1 end
    saveGateStats(stats)
    pcall(uploadGateStats, stats)
    -- 上方输出结束后，前方保持关闭1秒，期间不显示任何内容
    termDev.setBackgroundColor(colors.black)
    termDev.clear()
    termDev.setCursorPos(1,1)
    sleep(1)
    -- 恢复空闲：进站保持默认，出站根据剩余次数已设置前方红石。
    if GATE_TYPE == 0 then setIdleRS() end
    screenOpen()
  else
    -- FAIL: keep front on; optionally play no audio
    playIfExists('Audio/no.dfpwm')
    local reason = ''
    if GATE_TYPE == 0 then
      -- 进站失败原因
      if not startMatches then
        reason = 'Start station mismatch'
      elseif not terminalExists then
        reason = 'Terminal not found'
      elseif (tonumber(data.trips_remaining) or 0) <= 0 then
        reason = 'No trips remaining'
      elseif hasEntered then
        reason = 'Already entered'
      else
        reason = 'Invalid ticket'
      end
    else
      -- Exit failure reasons (do not check whether entry matches current station)
      if not hasEntered then
        reason = 'Not entered yet'
      elseif not terminalExists then
        reason = 'Terminal not found'
      elseif terminalExists and not terminalMatchesCurrent then
        reason = 'Wrong terminal station'
      else
        reason = 'Invalid ticket'
      end
    end
    debugLog('gate_fail', { reason = reason, gateType = GATE_TYPE })
    screenFail(reason)
    waitButtons()
    setIdleRS(); screenOpen()
  end
end

-- Main loop
screenOpen()
while true do
  local ev, a, b, c = waitButtons()
  if ev == 'timer' and a == stationTimer then
    updateStationList()
    stationTimer = os.startTimer(120)
  elseif ev == 'timer' and a == updateTimer then
    -- Periodically fetch and update startup (takes effect after next reboot)
    if shell and shell.run then pcall(shell.run, 'wget', UPDATE_URL, 'startup') end
    updateTimer = os.startTimer(600)
  elseif ev == 'disk' then
    handleDiskInsert(a)
  elseif ev == 'disk_eject' then
    setIdleRS(); screenOpen()
  end
end