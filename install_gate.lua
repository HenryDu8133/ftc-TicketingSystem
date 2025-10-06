-- Installer: Gate (gate.lua -> startup)
-- GUI-based installer for CC:Tweaked

local GATE_URL = 'http://192.140.163.241:5244/d/API/TicketMachine/gate.lua?sign=OWy1wKkKhUhpnxXKeX6fRLePSg1XcaQgWOLvQbMuHRQ=:0'
local NO_URL   = 'http://192.140.163.241:5244/d/API/TicketMachine/no.dfpwm?sign=m8lfe5uwPMTloflsNx7AqMbfYuNI2VytfN61vYC8y-8=:0'
local PASS_URL = 'http://192.140.163.241:5244/d/API/TicketMachine/pass.dfpwm?sign=ZJfGDYnaxQU4JrGSh4NDzKZtjq3eMjYh9KHmMSAMKZA=:0'

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
  local drv = peripheral.find('drive') ~= nil
  clear()
  center(2, 'Gate Installer', colors.yellow)
  dev.setTextColor(colors.white)
  dev.setCursorPos(2,4); dev.write('Monitor: ' .. (okMon and 'OK' or 'Missing'))
  dev.setCursorPos(2,5); dev.write('Speaker: ' .. (spk and 'OK' or 'Missing'))
  dev.setCursorPos(2,6); dev.write('Disk Drive: ' .. (drv and 'OK' or 'Missing'))
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

local function chooseGateType()
  clear(); center(3, 'Select gate type', colors.white)
  Buttons = {}
  local bw, bh = 12, 3
  addButton(math.floor(w/2)-bw-2, 6, 'Entry', bw, bh, {colors.blue, colors.white}, function() end)
  addButton(math.floor(w/2)+2, 6, 'Exit', bw, bh, {colors.orange, colors.white}, function() end)
  local chosen
  while not chosen do
    local ev,a,b,c = os.pullEvent()
    if ev=='monitor_touch' then
      local px, py = b, c
      local entryBtn, exitBtn = Buttons[1], Buttons[2]
      if inRect(entryBtn, px, py) then chosen = 0 end
      if inRect(exitBtn, px, py) then chosen = 1 end
    end
  end
  return chosen
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

local function setInFile(path, pattern, replace)
  if not fs.exists(path) then return false end
  local f = fs.open(path, 'r'); local txt = f.readAll(); f.close()
  if not txt then return false end
  local new = txt:gsub(pattern, replace)
  local wf = fs.open(path, 'w'); if not wf then return false end; wf.write(new); wf.close(); return true
end

local function install()
  checkPeripherals(); waitButtons()
  clear(); center(3, 'Downloading gate.lua...', colors.white)
  if not wget(GATE_URL, 'gate.lua') then clear(); center(5, 'Download failed', colors.red); return end
  -- Rename to startup for auto-run
  if fs.exists('startup') then fs.delete('startup') end
  fs.move('gate.lua', 'startup')
  -- Audio files
  if not fs.isDir('Audio') then fs.makeDir('Audio') end
  clear(); center(4, 'Downloading audio...', colors.white)
  wget(NO_URL, 'no.dfpwm')
  wget(PASS_URL, 'pass.dfpwm')
  -- Station code
  local code = promptStation()
  if code == '' then clear(); center(6, 'Invalid code', colors.red); return end
  setInFile('startup', "local%s+CURRENT_STATION_CODE%s*=%s*'.-'", "local CURRENT_STATION_CODE = '"..code.."'")
  -- Gate type
  local gt = chooseGateType()
  setInFile('startup', "local%s+GATE_TYPE%s*=%s*%d+", "local GATE_TYPE = "..tostring(gt))
  -- API base address
  local api = promptApiEndpoint()
  if api ~= '' then writeAll('API_ENDPOINT.txt', api .. "\n") end
  clear(); center(7, 'Installed. Reboot to start.', colors.green)
end

install()