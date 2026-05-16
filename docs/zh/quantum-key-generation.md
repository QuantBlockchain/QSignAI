# 量子密钥生成

本文档描述用于认证每张照片墙卡片的、由量子派生的密钥材料。内容包括算法选择与理由、目标硬件、最终交付物的结构，以及该构造的实际价值。

实现位于 [`photo-wall/src/lib/quantum-signature.ts`](../../photo-wall/src/lib/quantum-signature.ts)。设备目录方面的补充信息（来自 qc-bc-interactive 演示）参见 [`qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md`](../../../qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md)。

---

## 1. 算法选择

### 1.1 我们生成什么

对于 Telegram 群组中的每个新发送者，系统会生成一个小而稳定的身份 bundle：

- 一个 **量子随机数**，取值 `[0, 1000]`，由量子测量派生；
- 一个 **Bell 态概率向量** `[P(00), P(01), P(10), P(11)]`，作为结构性见证；
- 一个 **ToyLWE 密钥对**，其公钥哈希显示在卡片上；
- 一个对 `username | messageText | quantumNumber` 的 **签名**；
- 一个由量子数与 Bell 态概率派生的、确定性的 **HSL 强调色**。

同一 `(groupId, senderId)` 后续的消息复用缓存的 bundle，因此每个用户在每个群组内只对应一个稳定身份。

### 1.2 算法选择与理由

整条管线由三个构件组成。每个构件的选择都对应"活动级演示"这一约束下的具体考量。

| 构件 | 选择 | 理由 |
|---|---|---|
| **量子熵** | Amazon Braket SV1 上的 4 量子比特随机数电路（100 shots），结果取 `topBitstring mod 1001` | 小电路适合 SV1 的延迟预算（典型任务 < 5 秒），同时避免 QPU 排队等待。`mod 1001` 给出便于展示的徽章 `Q#000`–`Q#1000`，同时仍从量子测量取熵。 |
| **量子结构性见证** | SV1 上的 2 量子比特 Bell 态 `\|Φ⁺⟩` 电路（200 shots），输出概率 `[P(00), P(01), P(10), P(11)]` | 理想模拟器应给出 ≈ `[0.5, 0, 0, 0.5]`。把经验向量保存下来既可驱动确定性的 HSL 颜色，也提供了"这条记录确实来自一次量子执行"的直观信号。 |
| **后量子身份** | 教学用 ToyLWE：SHAKE-256 从 `domain ‖ quantumSeed ‖ 32 字节 OS 随机` 派生密钥材料；SHA-256 链生成签名；公钥摘要前 12 个十六进制字符成为徽章 | LWE 是 NIST PQC 优胜者（Kyber/Dilithium）所基于的同一硬度假设。ToyLWE 是有意做得简单的教学替身，使链上构件的形态（公钥、公钥哈希、签名）与真实 PQC 迁移保持一致，同时保留肉眼可读的体积。 |

### 1.3 我们**不**主张什么

- **不是 BB84 / E91 / QKD**。量子密钥分发要求两个具有量子硬件的端点协作，并配合一条公开经典信道。墙面是单端点的活动体验，QKD 不会是合适的原语。
- **不是标准化 PQC**。ToyLWE 既不是 Kyber、Dilithium，也不是任何 NIST 标准方案，它是一种教学构件。如果要做生产迁移，请把 ToyLWE 替换为 `@aws-crypto/kyber` / `pq-crystals/dilithium` 等等——周围的管线（Braket 熵 + Bell 见证 + 每用户缓存 + ALB 前置的 DynamoDB 行）保持不变。
- **不是容错型密码分析**。4 量子比特电路是一个随机源，**不是** Shor / Grover 实例。徽章演示的是"活动级别的量子认证身份"，不是量子攻击或量子密钥建立会话。

---

## 2. 设备规格

### 2.1 主执行目标

| 属性 | 取值 |
|---|---|
| 提供方 | Amazon Web Services |
| 服务 | Amazon Braket |
| 设备 | **SV1 — 按需态向量模拟器** |
| 设备 ARN | `arn:aws:braket:::device/quantum-simulator/amazon/sv1` |
| 最大量子比特 | 34（我们用 4 个做随机数，2 个做 Bell 态） |
| 使用区域 | 默认 `us-west-2`；通过 `AWS_REGION_NAME` 可配置 |
| 结果存储 | `BRAKET_BUCKET` 配置的 S3 桶，前缀 `braket-results/` |
| 典型延迟 | 端到端 2–5 秒/任务 |
| 是否支持 OpenQASM 3.0 | 是；电路以 `braket.ir.openqasm.program` 形式提交 |

选择 SV1 是因为它无需排队、跨区域可用，且其延迟落在墙面 `GET /api/messages/[groupId]` 5 秒轮询周期之内。真正的 QPU 执行考虑排队后通常需要 5–60 分钟，会迫使墙面进入"待签名"异步流程，但对演示叙事并无实质性增加。

### 2.2 回退路径

当 Braket 不可用时，代码会回退到一条确定性的本地管线，确保墙面永远不会阻塞发送者：

| 阶段 | 回退行为 |
|---|---|
| 量子随机数 | `shake256(\"quantum:\" + username + \":\" + Date.now()).readUInt16BE(0) mod 1001` |
| Bell 态 | 静态 `[0.5, 0, 0, 0.5]`（无噪声理想值） |
| 算法标记 | `algorithm: \"ToyLWE-local-fallback\"` |
| 设备标记 | `device: \"local-fallback\"` |

回退路径生成的卡片在视觉上与 Braket 行不可区分（保留活动 UX），但管理员后台会暴露 `algorithm` 与 `device` 字段，以便审计时区分。

### 2.3 面向未来的 QPU 目标

同一条 `BraketClient + CreateQuantumTaskCommand` 路径无需改动代码即可指向真实 QPU；只需调整设备 ARN 与 shots。下表整理自 `qc-bc-interactive/docs/AWS_BRAKET_QUANTUM_DEVICES.md` 的设备目录：

| 体系 | 代表设备 | 替换 SV1 的理由 |
|---|---|---|
| 离子阱 | IonQ Aria-1 / Forte-1（us-east-1）、AQT IBEX-Q1（eu-north-1） | 全互联拓扑、世界领先的门保真度；适合"必须是真实 QPU"叙事重于单任务延迟的场景 |
| 超导 | IQM Garnet（20 比特）/ Emerald（54 比特，eu-north-1）、Rigetti Ankaa-3（84 比特，us-west-1） | 纳秒级门时间；适合放大规模的随机数生成或活动后批量签名 |
| 中性原子 | QuEra Aquila（256 比特，us-east-1） | 可编程拓扑、AHS 范式；不能直接替代基于门的 RNG 电路，但适合做主题性的 reservoir 风格输出 |
| 托管模拟器 | DM1（密度矩阵）、TN1（张量网络） | 前者用于建模噪声，后者用于更宽电路的教学变体 |

如果要切换到真实 QPU，需要放宽 `runOnSV1` 中 30 秒的轮询窗口，并把 `signatureStatus = "queued"` 状态传到 UI。

---

## 3. 关键组件——最终交付物

每条已签名消息保存的"密钥材料"小且自包含，结构与 `photo-wall/src/lib/quantum-signature.ts` 中的 `QuantumSignature` 接口一致：

```ts
export interface QuantumSignature {
  quantumNumber: number;          // 0..1000
  publicKeyHash: string;          // 12 个大写十六进制字符
  signature: string;              // 24 个 base64 字符
  bellState: [number, number, number, number]; // [P(00), P(01), P(10), P(11)]
  algorithm: string;              // "ToyLWE-Braket-SV1" | "ToyLWE-local-fallback"
  visualColor: string;            // "hsl(h, s%, l%)"
  device: string;                 // "SV1" | "local-fallback"
}
```

### 3.1 各阶段产出

| 阶段 | 产物 | 在数据行中的字段 |
|---|---|---|
| **原始量子随机比特** | 4 量子比特 RNG 电路 100 shots 中出现频率最高的比特串 | 不原样保存；坍缩为 `quantumNumber = int(topBitstring, 2) mod 1001` |
| **容错聚合** | 取众数比特串等价于一种简化的多数投票纠错；与 `mod 1001` 一起吸收模拟器的单 shot 噪声 | `quantumNumber` |
| **隐私放大** | `xof = SHAKE-256(\"ToyLWE-KeyGen-v1\" ‖ quantumSeed ‖ os.urandom(32), 64)` 把量子熵与 32 字节 OS 随机混合，打破任务级关联 | 不保存；混入 `publicKeyHash` 与 `signature` |
| **最终密钥材料（公开）** | `publicKeyHash = SHA-256(xof[0:32])[0:12]`（大写十六进制）；`signature = base64(SHA-256(msgHash ‖ entropyHash ‖ pkHash))[0:24]` | `publicKeyHash`、`signature` |
| **结构性见证** | 2 量子比特 `\|Φ⁺⟩` 电路（200 shots）的经验 Bell 态概率 | `bellState` |
| **审计元数据** | 标记本行由 SV1 还是回退路径产生 | `algorithm`、`device`，以及 DynamoDB 的 `signatureStatus` |
| **呈现派生** | `hue = (quantumNumber × 137.5) mod 360`；`sat = 70 + bellState[0] × 30`；`light = 45 + bellState[3] × 20` | `visualColor` |

### 3.2 卡片实际显示什么

每张卡片上呈现的徽章是该 bundle 的紧凑投影：

```
Q#{quantumNumber} | {publicKeyHash}        例如  Q#452 | 7B284BB3D413
```

完整的 `signature`、`bellState`、`algorithm`、`device` 字段在管理员后台可见，用于溯源审计（见 [`docs/zh/architecture.md` — 管理员流程](architecture.md#管理员流程) 与 [`docs/zh/user-experience/Readme.md` — 第 3 屏](user-experience/Readme.md#3--管理员后台-page-3png)）。

---

## 4. 实际价值

### 4.1 在本演示内

- **零安装成本下的稳定每用户身份**。Telegram 发送者直接对应 Braket 派生的 `Q#number | publicKeyHash`，跨消息保持一致；无需账号、钱包或注册流程。
- **观众可读的量子执行**。Bell 态向量与 SV1 / 本地回退标记让主持人在台上可以说"这张卡是 5 秒前在 AWS Braket 上跑的电路签出来的"，并在管理员后台得到证据。
- **可审计的审核溯源**。软删除行保留完整签名 bundle，因此审计轨迹不会因为审核而丢失，也不会暴露底层消息存储。

### 4.2 演示之外

同样形态的管线可以推广到若干现实场景：

- **量子种子化的会话令牌**。把 ToyLWE 替换为 Dilithium，并把照片墙改造为带鉴权的会话 API，就可以得到每用户的 PQC token，其熵可以证明来自一次量子测量，同时保留相同的审计元数据（`algorithm`、`device`）。
- **活动 QR 入场 / 出席证明**。`Q#number | publicKeyHash` 的投影长度足以放进 QR 码，可以衍生为 PQC 风格的出席 NFT 或 Web3 徽章，由现场活动签名背书。
- **链上身份的后量子迁移演练**。由于外壳是 LWE 形态的，调用点可以原样接入 Kyber/Dilithium 实现，从而在团队真正承诺某个 PQC 栈之前先在 UX 层面演练这场迁移。
- **与 QKD / E91 对话的教学锚点**。明确指出本演示**不是** QKD 会话，可以为讲师提供一个具体参考，便于解释为什么 QKD 需要不同的部署模式与配对端点。

### 4.3 需要清醒认识的边界

- ToyLWE 仅用于演示，**不要**用它保护真实资产。
- SV1 是模拟器；本演示中真正的"量子"在熵源与结构性见证。
- 回退路径有密码学种子，但**不是**量子测量；对外沟通溯源时请以 `device` 与 `algorithm` 字段为准。
- `runOnSV1` 中 30 秒的轮询窗口是为 SV1 调优的；切换到真实 QPU 时需要扩大该窗口，并把 `queued` 状态传到 UI。
