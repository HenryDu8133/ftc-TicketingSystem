-- Updater: Gate (refresh main program and preserve local config)
-- Steps: read station and gate type from existing program, delete old, wget new, then restore config

local GATE_URL = 'http://192.140.163.241:5244/d/API/TicketMachine/gate.lua?sign=OWy1wKkKhUhpnxXKeX6fRLePSg1XcaQgWOLvQbMuHRQ=:0'

local function println(msg, col)
  if term and term.setTextColor and col then term.setTextColor(col) end
  print(msg)
  if term and term.setTextColor then term.setTextColor(colors.white) end
end

local function readAll(path)
  if not fs.exists(path) then return nil end
  local f = fs.open(path, 'r'); if not f then return nil end
  local c = f.readAll(); f.close(); return c
end

local function writeAll(path, content)
  local f = fs.open(path, 'w'); if not f then return false end
  f.write(content); f.close(); return true
end

local function detectExistingPath()
  if fs.exists('startup') then return 'startup' end
  if fs.exists('gate.lua') then return 'gate.lua' end
  return nil
end

local function captureConfig()
  local path = detectExistingPath()
  local txt = path and readAll(path) or ''
  local station = '01-01'
  local gtype = '0'
  if type(txt) == 'string' and #txt > 0 then
    station = txt:match("local%s+CURRENT_STATION_CODE%s*=%s*'([^']+)'") or station
    gtype   = txt:match("local%s+GATE_TYPE%s*=%s*(%d+)") or gtype
  end
  return station, gtype
end

local function wget(url, target)
  if shell and shell.run then
    local ok = pcall(shell.run, 'wget', url, target)
    if ok and fs.exists(target) then return true end
  end
  if http and http.get then
    local ok, res = pcall(http.get, url)
    if ok and res then
      local data = res.readAll(); res.close()
      local f = fs.open(target, 'w')
      if f then f.write(data); f.close(); return true end
    end
  end
  return false
end

local function deleteOld()
  if fs.exists('startup') then pcall(fs.delete, 'startup') end
  if fs.exists('gate.lua') then pcall(fs.delete, 'gate.lua') end
end

local function applyConfig(path, station, gtype)
  local txt = readAll(path) or ''
  if #txt == 0 then return false end
  txt = txt:gsub("local%s+CURRENT_STATION_CODE%s*=%s*'[^']*'", "local CURRENT_STATION_CODE = '"..station.."'")
  txt = txt:gsub("local%s+GATE_TYPE%s*=%s*%d+", "local GATE_TYPE = "..gtype)
  return writeAll(path, txt)
end

local function main()
  println('Gate Update: start', colors.yellow)
  local station, gtype = captureConfig()
  println(('Preserved config: station=%s type=%s'):format(station, gtype), colors.lightBlue)
  deleteOld()
  println('Downloading new main program (startup)...', colors.white)
  if not wget(GATE_URL, 'startup') then
    println('Download failed: please check network or URL', colors.red)
    return
  end
  if applyConfig('startup', station, gtype) then
    println('Config restored: CURRENT_STATION_CODE and GATE_TYPE', colors.green)
  else
    println('Failed to restore config: please check startup file', colors.red)
  end
  -- Write/preserve API endpoint
  local prev = readAll('API_ENDPOINT.txt')
  println('API endpoint: enter to keep current or input new', colors.white)
  if prev and #prev > 0 then println('Current: '..prev:gsub('\n',''), colors.lightBlue) end
  write('API: ')
  local addr = read()
  addr = (addr or ''):gsub('^%s+',''):gsub('%s+$','')
  if addr == '' then addr = (prev or ''):gsub('\n','') end
  if addr ~= '' then writeAll('API_ENDPOINT.txt', addr .. "\n"); println('API_ENDPOINT.txt written', colors.green) else println('API not set, skipping', colors.orange) end
  println('Update complete: takes effect after reboot (run reboot to restart)', colors.green)
end

main()