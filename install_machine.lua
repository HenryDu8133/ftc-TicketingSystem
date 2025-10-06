-- Installer: Ticket Machine (startup.lua)
-- GUI-based installer for CC:Tweaked

local STARTUP_URL = 'http://192.140.163.241:5244/d/API/TicketMachine/startup.lua?sign=28_QkC74yDxEBU08haE9JzDp-ldlOSSc0mmvtNGF_Vc=:0'

-- UI helpers
local monitor = peripheral.find('monitor')
local function termSafe()
  if monitor then return peripheral.wrap(peripheral.getName(monitor)) end
  return term
end
local dev = termSafe()
local w, h = dev.getSize()
if monitor then pcall(monitor.setTextScale, 0.5) end

local Buttons = {}
local function clear()
  dev.setBackgroundColor(colors.black)
  dev.clear()
  dev.setCursorPos(1,1)
end
local function center(y, txt, col)
  dev.setTextColor(col or colors.white)
  local x = math.max(1, math.floor((w - #txt)/2))
  dev.setCursorPos(x, y)
  dev.write(txt)
end
local function addButton(x, y, label, bw, bh, colorsPair, onClick)
  local b = {x=x, y=y, w=bw, h=bh, label=label, colors=colorsPair, onClick=onClick}
  table.insert(Buttons, b)
  dev.setBackgroundColor(colorsPair[1])
  dev.setTextColor(colorsPair[2])
  for i=0,bh-1 do dev.setCursorPos(x, y+i); dev.write(string.rep(' ', bw)) end
  local lx = x + math.floor((bw - #label)/2)
  local ly = y + math.floor(bh/2)
  dev.setCursorPos(lx, ly); dev.write(label)
end
local function inRect(b, px, py) return px>=b.x and px<=b.x+b.w-1 and py>=b.y and py<=b.y+b.h-1 end
local function waitButtons()
  while true do
    local ev,a,b,c = os.pullEvent()
    if ev=='monitor_touch' then
      for _,bt in ipairs(Buttons) do if inRect(bt,b,c) then if bt.onClick then bt.onClick() end; return end end
    end
  end
end

local function checkPeripherals()
  local okMon = monitor ~= nil
  local spk = peripheral.find('speaker') ~= nil
  local prn = peripheral.find('printer') ~= nil
  clear()
  center(2, 'Ticket Machine Installer', colors.yellow)
  dev.setTextColor(colors.white)
  dev.setCursorPos(2,4); dev.write('Monitor: ' .. (okMon and 'OK' or 'Missing'))
  dev.setCursorPos(2,5); dev.write('Speaker: ' .. (spk and 'OK' or 'Missing'))
  dev.setCursorPos(2,6); dev.write('Printer: ' .. (prn and 'OK' or 'Missing'))
  dev.setCursorPos(2,8); dev.write('Tip: station codes can be separated by "/"')
  Buttons = {}
  addButton(math.floor(w/2)-6, h-3, 'Install', 12, 3, {colors.green, colors.white}, function() end)
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
      local f = fs.open(target, 'w'); if f then f.write(data); f.close(); return true end
    end
  end
  return false
end

local function promptStation()
  clear(); center(3, 'Enter current station code (use "/" to separate)', colors.white)
  local prev = term.current(); term.redirect(dev)
  dev.setCursorPos(2, 6); dev.setTextColor(colors.yellow); dev.write('Code: ')
  local code = read()
  term.redirect(prev)
  return (code or ''):gsub('%s+', '')
end

local function promptStationName()
  clear(); center(3, 'Enter current station name', colors.white)
  local prev = term.current(); term.redirect(dev)
  dev.setCursorPos(2, 6); dev.setTextColor(colors.yellow); dev.write('Name: ')
  local name = read()
  term.redirect(prev)
  return (name or ''):gsub('^%s+', ''):gsub('%s+$', '')
end

local function promptApiEndpoint()
  clear(); center(3, 'Enter API base address (e.g. http://<PC-IP>:23333/api)', colors.white)
  local prev = term.current(); term.redirect(dev)
  dev.setCursorPos(2, 6); dev.setTextColor(colors.yellow); dev.write('API: ')
  local addr = read()
  term.redirect(prev)
  addr = (addr or ''):gsub('^%s+', ''):gsub('%s+$', '')
  return addr
end

local function writeAll(path, content)
  local f = fs.open(path, 'w'); if not f then return false end
  f.write(content); f.close(); return true
end

local function setVarsAtTop(path, code, name)
  if not fs.exists(path) then return false end
  local f = fs.open(path, 'r'); local txt = f.readAll() or ''; f.close()
  -- Remove old definitions to avoid duplication
  txt = txt:gsub("local%s+CURRENT_STATION_CODE%s*=%s*'.-'%s*\n?", '')
  txt = txt:gsub("local%s+CURRENT_STATION_NAME%s*=%s*'.-'%s*\n?", '')
  local header = "local CURRENT_STATION_CODE = '"..code.."'\n" ..
                 "local CURRENT_STATION_NAME = '"..name.."'\n"
  local wf = fs.open(path, 'w'); if not wf then return false end
  wf.write(header .. txt); wf.close(); return true
end

local function install()
  checkPeripherals(); waitButtons()
  clear(); center(3, 'Downloading startup.lua...', colors.white)
  if not wget(STARTUP_URL, 'startup.lua') then clear(); center(5, 'Download failed', colors.red); return end
  local code = promptStation()
  local name = promptStationName()
  if code == '' then clear(); center(6, 'Invalid code', colors.red); return end
  if name == '' then clear(); center(7, 'Invalid name', colors.red); return end
  setVarsAtTop('startup.lua', code, name)
  -- API base address
  local api = promptApiEndpoint()
  if api ~= '' then writeAll('API_ENDPOINT.txt', api .. "\n") end
  -- Ensure autostart: create startup wrapper
  local sf = fs.open('startup', 'w')
  if sf then sf.write("shell.run('startup.lua')"); sf.close() end
  clear(); center(6, 'Installed. Reboot to start.', colors.green)
end

install()