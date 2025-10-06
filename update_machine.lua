
-- Updater: Ticket Machine (refresh startup program while preserving station config)
-- Steps: read CURRENT_STATION_CODE from existing startup.lua, remove old program,
-- wget the new version, then write back the station code

local STARTUP_URL = 'http://192.140.163.241:5244/d/API/TicketMachine/startup.lua?sign=28_QkC74yDxEBU08haE9JzDp-ldlOSSc0mmvtNGF_Vc=:0'

local function println(msg, col)
  if term and term.setTextColor and col then term.setTextColor(col) end
  print(msg)
  if term and term.setTextColor then term.setTextColor(colors.white) end
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

local function readAll(path)
  if not fs.exists(path) then return nil end
  local f = fs.open(path, 'r'); if not f then return nil end
  local c = f.readAll(); f.close(); return c
end

local function writeAll(path, content)
  local f = fs.open(path, 'w'); if not f then return false end
  f.write(content); f.close(); return true
end

local function captureStationCode()
  local txt = readAll('startup.lua') or readAll('startup') or ''
  local code = '01-01'
  if type(txt) == 'string' and #txt > 0 then
    code = txt:match("local%s+CURRENT_STATION_CODE%s*=%s*'([^']+)'") or code
  end
  return code
end

local function deleteOld()
  if fs.exists('startup.lua') then pcall(fs.delete, 'startup.lua') end
  if fs.exists('startup') then pcall(fs.delete, 'startup') end
end

local function ensureWrapper()
  -- 仅在需要时创建 wrapper，保持自动启动
  local sf = fs.open('startup', 'w')
  if sf then sf.write("shell.run('startup.lua')"); sf.close() end
end

local function main()
  println('Ticket Machine Update: start', colors.yellow)
  local station = captureStationCode()
  println(('Preserved CURRENT_STATION_CODE=%s'):format(station), colors.lightBlue)
  deleteOld()
  println('Downloading new main program (startup.lua)...', colors.white)
  if not wget(STARTUP_URL, 'startup.lua') then
    println('Download failed: please check network or URL', colors.red)
    return
  end
  -- 写回站点配置
  local txt = readAll('startup.lua') or ''
  if #txt > 0 then
    txt = txt:gsub("local%s+CURRENT_STATION_CODE%s*=%s*'[^']*'", "local CURRENT_STATION_CODE = '"..station.."'")
    writeAll('startup.lua', txt)
    println('Config restored: CURRENT_STATION_CODE', colors.green)
  else
    println('Warning: new startup.lua empty, skip config restore', colors.red)
  end
  -- 写入/保留 API 地址
  local prev = readAll('API_ENDPOINT.txt')
  println('API endpoint: enter to keep current or input new', colors.white)
  if prev and #prev > 0 then println('Current: '..prev:gsub('\n',''), colors.lightBlue) end
  write('API: ')
  local addr = read()
  addr = (addr or ''):gsub('^%s+',''):gsub('%s+$','')
  if addr == '' then addr = (prev or ''):gsub('\n','') end
  if addr ~= '' then writeAll('API_ENDPOINT.txt', addr .. "\n"); println('API_ENDPOINT.txt written', colors.green) else println('API not set, skipping', colors.orange) end
  ensureWrapper()
  println('Update complete: startup.lua written, autostart preserved', colors.green)
  println('Tip: takes effect after reboot (run reboot to restart)', colors.lightBlue)
end

main()