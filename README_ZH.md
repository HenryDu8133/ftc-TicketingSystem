
# FTC 票务系统

[![支持 PR](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://makeapullrequest.com) [![使用 Lua](https://img.shields.io/badge/Made%20with-Lua-blue)]() [![CC:Tweaked](https://img.shields.io/badge/CC%3ATweaked-ComputerCraft-blue)](https://tweaked.cc/) [![Node.js 16+](https://img.shields.io/badge/Node.js-16%2B-green)](https://nodejs.org/) [![Open Source](https://img.shields.io/badge/Open%20Source-%E2%9D%A4-red)]() [![注释：英文](https://img.shields.io/badge/%E6%B3%A8%E9%87%8A-%E8%8B%B1%E6%96%87-blue)]()
[![MIT 许可证](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

基于 CC:Tweaked 的票务解决方案：售票机与闸机，以及用于站点/线路/票价管理与票务事件日志的 Web 控制台。

## 功能
- 售票机：界面与语音引导、打印、软盘 TICKET 写入、售票统计上传
- 闸机：软盘票检、红石控制、状态上传（进站/出站）
- 控制台：管理站点/线路/票价、查看票务日志/事件、支持在区间中插入站点
- 每次售票生成唯一票号；打印前检查纸量与出纸槽

## 组件
- `Lua/TicketMachine/startup.lua`：售票机主程序
- `Lua/TicketMachine/gate.lua`：闸机主程序（进站/出站）
- `Lua/TicketMachine/web/server.js`：后端 API
- `Lua/TicketMachine/web/main.js`：前端主逻辑
- `Lua/TicketMachine/web/app.js`：前端 API 封装
- `Lua/TicketMachine/web/console.js`：控制台脚本

## 环境要求
- 安装 CC:Tweaked 模组的 Minecraft
- 售票机需要监视器（可选）、音响、打印机与软盘驱动器
- Web 控制台需要 Node.js 16+ 

## 部署
### 售票机
- 运行`install_machine.lua`
- 填写车站编号、车站名称、API路径

### 闸机
- 运行`install_gate.lua`
- 填写填写车站编号、选择闸机类型、API路径

## 使用
- 售票：选择站点、类型与次数，支付后进入打印检查，随后打印并写盘
- 验票：插入软盘后自动校验并开门；多程票在扣次并更新后自动弹盘
- 控制台：管理基本数据；在区间 Shift-点击可插入站点

---

## 安装与运行

**前置条件**
- 安装 `Node.js 16+`（推荐 18+）

**安装依赖**
- 在项目根目录执行：`npm install`

**启动 Web 控制台**
- 方式一（根目录）：`node web/server.js`
- 方式二（进入子目录）：`cd web && node server.js`
- 默认访问地址：`http://localhost:23333/`（可通过环境变量 `HOST`、`PORT` 覆盖）

**首次配置**
- 进入“系统设置”，设置 `API 地址`（默认同源 `/api`）。
- 也可编辑 `web/data/config.json` 中的 `api_base`。

**数据导入/导出**
- 在控制台界面使用“导入数据 / 导出数据”按钮；导出文件名为 `ftc-ticket-admin-backup.json`。
