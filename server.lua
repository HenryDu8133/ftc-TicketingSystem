
-- Internal Audio Server for CC:Tweaked
-- Listens on channel 65005 and serves files from disk/Audio
-- MADE BY Henry_Du henrydu@henrycloud.ink 

local AUDIO_CHANNEL = 65005

local function ensureFrontModem()
  if peripheral.isPresent('top') and peripheral.hasType('top', 'modem') then
    local m = peripheral.wrap('top')
    if m and (not m.isOpen or not m.isOpen(AUDIO_CHANNEL)) then
      pcall(m.open, AUDIO_CHANNEL)
    end
    pcall(rednet.open, 'top')
    return m
  end
  return nil
end

local function getDiskAudioPath()
  local mount = 'disk'
  local d = peripheral.find('drive')
  if d and d.getMountPath then
    local mp = d.getMountPath()
    if mp and #mp > 0 then mount = mp end
  end
  return fs.combine(mount, 'Audio')
end

local modem = ensureFrontModem()
if not modem then
  print('Server: No top modem found.')
  return
end

print('Server: Listening on channel ' .. AUDIO_CHANNEL)

while true do
  local ev, side, rch, rply, message = os.pullEvent()
  if ev == 'modem_message' and rch == AUDIO_CHANNEL then
    local req = message
    if type(message) == 'string' then
      local okJ, decodedJ = pcall(textutils.unserializeJSON, message)
      if okJ and type(decodedJ) == 'table' then req = decodedJ end
      if type(req) ~= 'table' then
        local okL, decodedL = pcall(textutils.unserialize, message)
        if okL and type(decodedL) == 'table' then req = decodedL end
      end
    end
    if type(req) == 'table' and req.cmd == 'AUD_SYNC' then
      local base = getDiskAudioPath()
      if fs.exists(base) and fs.isDir(base) then
        for _, name in ipairs(fs.list(base)) do
          local path = fs.combine(base, name)
          if fs.isDir(path) then goto continue end
          local h = fs.open(path, 'r')
          local content = h and h.readAll()
          if h then h.close() end
          if content then
            local payload = { cmd = 'AUD_FILE', name = name, data = content }
            local out = textutils.serialize(payload)
            pcall(modem.transmit, AUDIO_CHANNEL, AUDIO_CHANNEL, out)
            print('Server: sent ' .. name)
          end
          ::continue::
        end
      else
        print('Server: disk/Audio not found')
      end
    elseif type(req) == 'table' and req.cmd == 'AUD_LIST' then
      local base = getDiskAudioPath()
      local names = {}
      if fs.exists(base) and fs.isDir(base) then
        for _, name in ipairs(fs.list(base)) do
          local p = fs.combine(base, name)
          if not fs.isDir(p) then table.insert(names, name) end
        end
      end
      local payload = { cmd = 'AUD_LIST_RESULT', names = names }
      local out = textutils.serialize(payload)
      pcall(modem.transmit, AUDIO_CHANNEL, AUDIO_CHANNEL, out)
      print('Server: listed ' .. tostring(#names) .. ' files')
    end
  elseif ev == 'rednet_message' then
    local sender, msg, proto = side, rch, rply
    if proto == 'AUD_SYNC' or (type(msg) == 'table' and msg.cmd == 'AUD_SYNC') then
      local base = getDiskAudioPath()
      if fs.exists(base) and fs.isDir(base) then
        for _, name in ipairs(fs.list(base)) do
          local path = fs.combine(base, name)
          if fs.isDir(path) then goto continue_r end
          local h = fs.open(path, 'r')
          local content = h and h.readAll()
          if h then h.close() end
          if content then
            local payload = { cmd = 'AUD_FILE', name = name, data = content }
            pcall(rednet.send, sender, payload, 'AUD_SYNC')
            print('Server:rednet sent ' .. name)
          end
          ::continue_r::
        end
      else
        print('Server: disk/Audio not found')
      end
    elseif proto == 'AUD_LIST' or (type(msg) == 'table' and msg.cmd == 'AUD_LIST') then
      local base = getDiskAudioPath()
      local names = {}
      if fs.exists(base) and fs.isDir(base) then
        for _, name in ipairs(fs.list(base)) do
          local p = fs.combine(base, name)
          if not fs.isDir(p) then table.insert(names, name) end
        end
      end
      local payload = { cmd = 'AUD_LIST_RESULT', names = names }
      pcall(rednet.send, sender, payload, 'AUD_LIST')
      print('Server:rednet listed ' .. tostring(#names) .. ' files')
    end
  end
end