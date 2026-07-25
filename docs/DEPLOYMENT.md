# 部署

应根据浏览器、ConvoSketchpad 服务端和 OpenClaw Gateway 的运行位置选择拓扑。条件允许时，优先从同机部署开始。

<a id="local-same-machine"></a>

## 浏览器、服务端与 Gateway 位于同一台机器

```text
浏览器（localhost）→ ConvoSketchpad（127.0.0.1:3080）→ Gateway（127.0.0.1:18789）
```

这是默认拓扑，涉及的网络环节最少。

```bash
curl -fsSL https://raw.githubusercontent.com/MrToyy/convosketchpad/main/install.sh | bash
cd ~/convosketchpad
npm run setup
```

推荐的配置向导选项：

- 访问方式：**仅本机（localhost）**
- 认证：仅限 localhost 访问时可不启用

重启受管服务，或直接运行：

```bash
sudo systemctl restart convosketchpad.service
# 或
npm run prod
```

验证：

```bash
openclaw gateway status
curl -fsS http://127.0.0.1:18789/health
curl -fsS http://127.0.0.1:3080/health
```

如果 Gateway 认证或设备权限已经过期，重新运行 `npm run setup`。配置向导使用 OpenClaw 原生设备流程。需要手动审批时，检查并批准准确的请求：

```bash
openclaw devices list --json
openclaw devices approve <requestId>
```

如果浏览器仍保存手动输入的过期 Gateway Token，请清除站点数据或删除 `localStorage.oc-config`。

<a id="local-ui-with-a-remote-gateway"></a>

## 本机界面连接远程 Gateway

```text
浏览器（localhost）→ 本机 ConvoSketchpad → 私有网络 → 远程 OpenClaw Gateway
```

使用 Tailscale、WireGuard 或 SSH 隧道，避免把 Gateway 端口直接暴露到公网。

在本机 ConvoSketchpad 宿主机上配置：

```bash
GATEWAY_URL=https://gateway.example.internal
GATEWAY_TOKEN=<token>
CONVOSKETCHPAD_GATEWAY_TIMEZONE=Asia/Shanghai
WS_ALLOWED_HOSTS=gateway.example.internal
```

将 `CONVOSKETCHPAD_GATEWAY_TIMEZONE` 设置为 Gateway 宿主机时区。Canvas 会结合该时区和 OpenClaw 实际生效的每日、空闲重置策略，在重置后的首次发送中恢复上下文。

在 Gateway 宿主机上检查并合并浏览器访问 ConvoSketchpad 使用的 Origin：

```bash
openclaw config get gateway.controlUi.allowedOrigins --json
openclaw config patch --file ./convosketchpad-origin.patch.json5 --dry-run
openclaw config patch --file ./convosketchpad-origin.patch.json5
```

补丁示例：

```json5
{
  gateway: {
    controlUi: {
      allowedOrigins: [
        "http://localhost:3080",
        "http://127.0.0.1:3080",
        // 保留现有条目。
      ],
    },
  },
}
```

在该宿主机上使用 `openclaw devices list --json` 和 `openclaw devices approve <requestId>` 配对 ConvoSketchpad 设备。本机配置向导不会写入远程宿主机配置。

Canvas 执行、事件、Branch/Fork 行为、上传、原生 Artifact 下载和用量查询都通过 Gateway 完成。远程部署的上传不需要共享工作区。只有当旧版绝对路径 Artifact 在 ConvoSketchpad 宿主机上真实存在，并属于 Gateway 报告的工作区根目录时，才可能恢复；其他情况会明确降级。

验证两个健康检查端点，然后测试 Agent 发现、文本 Interaction，以及适合当前文件系统拓扑的附件。

<a id="remote-browser-access"></a>

## 远程浏览器访问

推荐拓扑：

```text
远程浏览器 → HTTPS 反向代理 → ConvoSketchpad → 本机 OpenClaw Gateway
```

必需配置：

```bash
HOST=0.0.0.0
CONVOSKETCHPAD_AUTH=true
CONVOSKETCHPAD_SESSION_SECRET=<stable-random-secret>
GATEWAY_URL=http://127.0.0.1:18789
```

还需要配置：

- 通过 Caddy、Nginx、Traefik、Tailscale Serve 或同类组件提供 HTTPS。
- 对会提供客户端 IP Header 的代理设置 `TRUSTED_PROXIES`。
- 将最终 Origin 同时写入 `ALLOWED_ORIGINS`、`CONVOSKETCHPAD_PUBLIC_ORIGIN` 和 OpenClaw `gateway.controlUi.allowedOrigins`。

创建受管用户并重启：

```bash
cd ~/convosketchpad
npm run setup
npm run users -- add <name>
sudo systemctl restart convosketchpad.service
```

必须一起备份 `database/canvas.sqlite` 和 `artifacts/`。

验证回环地址和公开地址的健康检查，然后依次检查登录、Agent 发现、Canvas 创建、文本和附件发送、Fork 以及 Artifact 下载。

<a id="tailscale"></a>

## Tailscale

Tailscale 可以在不开放公网端口的情况下提供远程访问。优先使用 Tailscale Serve，使 ConvoSketchpad 保持监听回环地址，并让浏览器通过 HTTPS 访问。

```bash
cd ~/convosketchpad
npm run setup
```

选择 **Tailscale Serve**，启用受管认证，并执行向导生成的 `tailscale serve` 命令。

以下配置中的最终 HTTPS Origin 必须一致：

- `CONVOSKETCHPAD_PUBLIC_ORIGIN`
- `ALLOWED_ORIGINS`
- OpenClaw `gateway.controlUi.allowedOrigins`

修改 Origin 后重启 ConvoSketchpad 和 Gateway。

```bash
tailscale status
tailscale serve status
curl -fsS https://<node-name>.<tailnet>.ts.net/health
```

如果直接使用 Tailscale IP 访问，请监听 `0.0.0.0`、启用 `CONVOSKETCHPAD_AUTH=true`，并把明文 HTTP 限制在可信 tailnet 内。

## 安全基线

- 不需要远程浏览器访问时，保持 `HOST=127.0.0.1`。
- 监听 `0.0.0.0` 前启用受管认证。
- 在可信本机以外访问时使用 HTTPS。
- 让 OpenClaw Gateway 仅监听回环地址或通过私有网络访问。
- 保持 ConvoSketchpad 与 OpenClaw 的公开 Origin 配置一致。
- 严格限制可信代理范围。

完整安全模型见[安全](SECURITY.md)，连接和 Session 恢复问题见[故障排查](TROUBLESHOOTING.md)。
