import { useNavigate } from 'react-router-dom';

const PrivacyPolicy = () => {
    const navigate = useNavigate();

    return (
        <div className="h-screen overflow-y-auto overflow-x-hidden bg-background font-sans text-foreground selection:bg-blue-100 selection:text-blue-900">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-card border-b border-border shadow-sm">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <button
                        onClick={() => navigate('/')}
                        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors bg-muted hover:bg-accent px-4 py-2 rounded border border-border"
                    >
                        <span className="material-symbols-outlined text-base">arrow_back</span>
                        返回 AetherGuard 控制台
                    </button>
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-foreground text-xl block">gavel</span>
                        <span className="font-semibold text-lg text-foreground">Aether 法律与合规中心</span>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="max-w-6xl mx-auto px-6 py-12 pb-32">
                {/* Title Area */}
                <div className="mb-12 pb-8 border-b border-border">
                    <h1 className="text-3xl md:text-4xl font-bold mb-4 text-foreground leading-tight">
                        AetherGuard 企业总隐私声明与数据处理增编 (DPA)
                    </h1>
                    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground bg-muted p-4 rounded border border-border mb-8 font-mono">
                        <div className="flex items-center gap-1"><strong>生效日期：</strong> 2026-02-21</div>
                        <div className="flex items-center gap-1"><strong>文档版本：</strong> 2026.1.A-Enterprise</div>
                        <div className="flex items-center gap-1"><strong>适用法域：</strong> PRC, GDPR (EU), CCPA/CPRA (US)</div>
                    </div>
                    <div className="text-sm text-muted-foreground leading-relaxed text-justify space-y-4">
                        <p>
                            本《隐私声明与数据处理增编》（以下简称“<strong>本声明</strong>”或“<strong>DPA</strong>”）构成客户（以下简称“<strong>客户</strong>”或“<strong>您</strong>”）与杭州视界奇点科技有限公司及/或其关联公司（以下简称“<strong>Aether Studio</strong>”、“<strong>我们</strong>”或“<strong>处理者</strong>”）之间关于访问和使用 AetherGuard 云端及边缘防护服务（以下统称“<strong>服务</strong>”）的主服务协议（MSA）的不可分割的一部分。
                        </p>
                        <p>
                            本声明极其详尽地界定了我们在提供服务时，作为数据处理者或服务提供商，代表作为数据控制者或业务所有者的您，进行系统日志采集、网络遥测、攻击特征提取以及自动化决策干预时的技术手段、合规边界、子处理者约束以及数据主体权利（DSR）的响应义务。我们严格遵循《中华人民共和国个人信息保护法》（PIPL）、《中华人民共和国数据安全法》（DSL）、《欧盟通用数据保护条例》（GDPR，条例 2016/679）以及《加州消费者隐私法案》（CCPA，经 CPRA 修订）的要求。
                        </p>
                    </div>
                </div>

                {/* Table of Contents */}
                <div className="bg-muted border border-border rounded p-6 mb-12">
                    <h2 className="text-base font-bold text-foreground mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-muted-foreground">format_list_bulleted</span>
                        协议条款导航
                    </h2>
                    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 text-sm text-blue-600 font-medium [&_a:hover]:text-blue-800 [&_a:hover]:underline">
                        <li><a href="#sec-1">1. 定义与解释</a></li>
                        <li><a href="#sec-2">2. 处理活动的作用与范围 (角色界定)</a></li>
                        <li><a href="#sec-3">3. 数据收集类别与分子级明细</a></li>
                        <li><a href="#sec-4">4. 深度包检测 (DPI) 与自动化处理限制</a></li>
                        <li><a href="#sec-5">5. 数据驻留、区域路由与跨境传输 (SCCs)</a></li>
                        <li><a href="#sec-6">6. 子处理者 (Sub-processors) 聘用与通知</a></li>
                        <li><a href="#sec-7">7. 技术与组织安全措施 (TOMs)</a></li>
                        <li><a href="#sec-8">8. 数据泄露通知与联合突发事件管理</a></li>
                        <li><a href="#sec-9">9. 数据主体的法定权利 (DSR) 协助义务</a></li>
                        <li><a href="#sec-10">10. 客户审计权与合规认证</a></li>
                        <li><a href="#sec-11">11. 数据生命周期及终止/删除指令</a></li>
                        <li><a href="#sec-12">12. 法定责任限制与争议解决</a></li>
                    </ul>
                </div>

                <div className="space-y-12 text-sm text-muted-foreground leading-relaxed text-justify">
                    {/* Section 1 */}
                    <Section id="sec-1" title="1. 定义与解释">
                        <ul className="list-disc list-inside space-y-3 pl-2">
                            <li><strong>客户数据 (Customer Data)</strong>：指客户或最终用户为使用服务而向我们提供的所有数据，包括文本、声音、视频、图像文件、软件或客户通过 AetherGuard 路由流经我们基础设施的网络载荷。</li>
                            <li><strong>系统生成日志 (System-Generated Logs)</strong>：指在服务运行期间自动生成的元数据、遥测、配置数据及性能度量，不包含客户内容载荷，已通过伪名化处理。</li>
                            <li><strong>个人数据 (Personal Data) / 个人信息 (Personal Information)</strong>：指与已识别或可识别的自然人相关的任何信息。</li>
                            <li><strong>子处理者 (Sub-processor)</strong>：指由 Aether Studio 雇佣，代表客户处理个人数据的任何第三方数据处理方（例如：云基础设施提供商）。</li>
                            <li><strong>标准合同条款 (SCCs)</strong>：指由欧盟委员会通过执行决定 (EU) 2021/914 颁布的，关于将个人数据转移至第三国的标准合同条款。</li>
                        </ul>
                    </Section>

                    {/* Section 2 */}
                    <Section id="sec-2" title="2. 处理活动的作用与范围 (角色界定)">
                        <p className="mb-3">
                            2.1 <strong>客户为控制者 (Controller)</strong>：客户全权负责确定所提供个人数据处理的目的和方式，确保收集或传输至本服务的数据已取得最终用户的有效同意或具备其他合法基础（如履行合同）。
                        </p>
                        <p className="mb-3">
                            2.2 <strong>Aether Studio 为处理者 (Processor)</strong>：我们仅根据客户在此主协议或相关控制台配置中所下达的书面指示处理客户数据（包括拦截、记录、流量清洗）。超出客户指示范围的处理是被严格禁止的，除非适用法律强制要求。
                        </p>
                        <p>
                            2.3 <strong>指示的合法性</strong>：如果本公司合理认为客户的某项指示违反了《个人信息保护法》或 GDPR 等适用数据保护法规，我们将立即通知客户，并有权中止执行该指示直至客户作出合规澄清。
                        </p>
                    </Section>

                    {/* Section 3 */}
                    <Section id="sec-3" title="3. 数据收集类别与分子级明细 (Data Categories)">
                        <p className="mb-4">我们将所处理的数据划分为极其精确的维度界限。我们只收集为履行合同安全义务所<strong>绝对必要</strong>（Data Minimization）的底层情报。</p>

                        <div className="border border-border rounded overflow-hidden">
                            <table className="min-w-full text-sm">
                                <thead className="bg-muted border-b border-border">
                                    <tr>
                                        <th className="px-5 py-3 font-semibold text-foreground text-left">数据分类</th>
                                        <th className="px-5 py-3 font-semibold text-foreground text-left">具体包含的字段明细 (Fields Exact Match)</th>
                                        <th className="px-5 py-3 font-semibold text-foreground text-left">收集目的</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    <tr>
                                        <td className="px-5 py-4 font-medium">客户账户与计费数据</td>
                                        <td className="px-5 py-4 text-muted-foreground">实体名称、DUNS代码、联系人全名、工作邮箱、加密的哈希密码 (Argon2id)、多因素认证(MFA)种子秘钥状态、支付掩码信息。</td>
                                        <td className="px-5 py-4 text-muted-foreground">身份验证、合同履行、开票、服务通讯。</td>
                                    </tr>
                                    <tr className="bg-muted/50">
                                        <td className="px-5 py-4 font-medium">L3/L4 边缘网络遥测</td>
                                        <td className="px-5 py-4 text-muted-foreground">源/目的 IPv4及IPv6地址、源/目的 TCP/UDP 端口、BGP ASN (自治系统编号)、ICMP 类型码、GeoIP (精确到城市级)、TCP Options (如 MSS, Window Scale 用于指纹识别)。</td>
                                        <td className="px-5 py-4 text-muted-foreground">DDoS 阈值检测、僵尸网络 (Botnet) 模型训练、连接速率限制 (Rate Limiting)。</td>
                                    </tr>
                                    <tr>
                                        <td className="px-5 py-4 font-medium">L7 应用层标头数据 (若托管 TLS)</td>
                                        <td className="px-5 py-4 text-muted-foreground">HTTP Request URI (含 query string，去参除敏感词)、Host / SNI、User-Agent 字典、Referer、Accept-Language、TLS 握手协议版本及 Cipher Suite 首选项 (JA3 指纹)。</td>
                                        <td className="px-5 py-4 text-muted-foreground">WAF 精准防御、爬虫拦截 (Bot Management)、SQLi/XSS 特征查杀。</td>
                                    </tr>
                                    <tr className="bg-muted/50">
                                        <td className="px-5 py-4 font-medium text-red-700">业务请求正文 (Request Body)</td>
                                        <td className="px-5 py-4 text-muted-foreground font-bold">【绝对不收集/不记录】</td>
                                        <td className="px-5 py-4 text-muted-foreground">AetherGuard 依靠报文信封决策。POST 表单及上传文件内容除非命中恶意正则签名，否则概不触碰、概不留存。</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </Section>

                    {/* Section 4 */}
                    <Section id="sec-4" title="4. 深度包检测 (DPI) 与自动化处理限制">
                        <SubSection title="4.1 DPI 缓冲区的物理级清零承诺">
                            <p className="mb-2 text-justify">
                                在面对高级 0-Day WAF 逃逸攻击时，客户可签署免责后显式开启 <strong>L7 Payload DPI 特性</strong>。在该模式下，部分请求正文将被解压并提取至我们的 WAF 计算节点的随机存取存储器 (RAM) 中。
                            </p>
                            <p className="bg-muted p-4 border-l-4 border-blue-600 text-foreground font-mono text-xs leading-relaxed">
                                安全约束条件：(a) 包含业务有效载荷的内存块 (Memory Chunks) 强制限制存活时长为不超过 <strong>500 毫秒 (500ms)</strong>。 <br />
                                (b) 一旦正则表达式机 (PCRE) 或检测集群返回“安全”与否的布尔值结果，底层 C/Rust 驱动将于释放指针前调用 <code>secure_zero_memory()</code> 对该区间 RAM 进行强制覆写抹除，确保无一字节降级写入或落盘至非易失性存储 (SSD/HDD)。
                            </p>
                        </SubSection>
                        <SubSection title="4.2 GDPR 第22条：拒绝纯自动化决策的豁免权">
                            <p>
                                针对系统引擎及内嵌的 LLM 多智能体所作出的阻断某区域或某类用户访问的“自动化决策”，可能对最终用户产生显著影响。客户在此确认，已通过自身平台的用户协议赋予用户适当的上诉权。Aether Studio 为控制台提供详尽的 <strong>Chain-of-Thought (思维推演路径)</strong> 审计支持，且控制台特设有强制“白名单释放 (Whitelist Bypass)”接口。您的网络管理员无论何时都能以最高优先级推翻机器模型的所有阻绝判定。
                            </p>
                        </SubSection>
                    </Section>

                    {/* Section 5 */}
                    <Section id="sec-5" title="5. 数据驻留、区域路由与跨境传输 (SCCs)">
                        <p className="mb-4">数据路由架构严格遵循就近访问及区域数据主权隔离标准：</p>
                        <div className="space-y-4">
                            <div className="border border-border p-4 rounded bg-card">
                                <h4 className="font-semibold text-foreground mb-1"> PRC (中国大陆) 数据闭环区域：</h4>
                                <p className="text-muted-foreground text-xs">
                                    如您的实体注册于中国大陆且节点部署于境内，所有 L4/L7 攻击拦截日志将被隔离存储于北京/张家口/杭州的 Tier-4 数据中心。除非获得中国国家网信办 (CAC) 的数据出境安全评估批准，否则底层 API 不允许境外管理面板拉取上述本地情报池。
                                </p>
                            </div>
                            <div className="border border-border p-4 rounded bg-card">
                                <h4 className="font-semibold text-foreground mb-1"> 跨国别实体 SCCs 自动执行协议：</h4>
                                <p className="text-muted-foreground text-xs text-justify">
                                    对于要求全球集中管控的企业（例如，美国总部查看法兰克福节点的报表），如果数据传输涉及将欧盟居民数据的遥测信息转移至非白名单国家（如美国或亚太部分地区），则适用欧盟委员会第 2021/914 号执行决定附件中制定的《标准合同条款》（模块二：控制者到处理者）。本 DPA 的签署将自动视为签署了 SCCs 全文及附件。Aether Studio 将负责落实补充技术措施（如伪名化、TLS 1.3 强加密隧道传输），以抵御境外政府不合理的监视请求。
                                </p>
                            </div>
                        </div>
                    </Section>

                    {/* Section 6 */}
                    <Section id="sec-6" title="6. 子处理者 (Sub-processors) 聘用与通知">
                        <p className="mb-3">
                            为提供云计算弹性与底层网络带宽，客户授权我们采用第三方基础支撑商。我们在附录中维护着一份经过预审的<a href="#" className="text-blue-600 hover:underline">现任子处理者公开清单</a>（包括 AWS, 阿里云, Cloudflare Infrastructure等）。
                        </p>
                        <ul className="list-decimal list-inside space-y-2 pl-2">
                            <li><strong>合规背靠背限制：</strong> 我们保证与每个子处理者均已签署书面的数据处理协议，并施加不低于本 DPA 中包含的数据保护义务。若子处理者未能履行其义务，Aether Studio 仍将向客户承担连带责任。</li>
                            <li><strong>变更通知期限：</strong> 如果我们计划增加或替换处理个人数据的子处理者，我们将至少提前 <strong>三十 (30) 天</strong> 通过邮件订阅或控制台向客户发送书面通知。</li>
                            <li><strong>异议权：</strong> 客户在此 30 天期内如有基于安全合规原因的合理异议，可书面告知。若无法协商解决，客户有权提前终止相关受影响的服务模块而无需承担违约金。</li>
                        </ul>
                    </Section>

                    {/* Section 7 */}
                    <Section id="sec-7" title="7. 技术与组织安全措施 (TOMs, Technical and Organizational Measures)">
                        <p className="mb-4 text-justify">
                            依据 GDPR 第 32 条以及由于涉及企业数字安全的基石，我们已实施全套严苛的 TOMs。以下提取自本公司的真实操作控制措施矩阵（SOC 2 / ISO 27001 被审计项目）：
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <h4 className="font-semibold text-foreground border-b border-border pb-1 mb-2">7.1 访问控制权确立 (Access Control)</h4>
                                <ul className="list-disc list-inside text-muted-foreground text-xs space-y-1">
                                    <li>系统默认拒绝一切越权访问 (Zero-Trust)。所有工程师必须通过包含无密码 YubiKey 的硬件 FIDO2 强认证，并接入办公网 VPN/SDP。</li>
                                    <li>针对包含明文或未脱敏日志的 SRE 数据库访问，采用 JIT (Just-In-Time) 权限颁发，审批工单限时 2 小时存活。</li>
                                    <li>任何内部命令均留存不可篡改的堡垒机操作录像（时长留存 1 年）。</li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-semibold text-foreground border-b border-border pb-1 mb-2">7.2 密码学实施 (Encryption)</h4>
                                <ul className="list-disc list-inside text-muted-foreground text-xs space-y-1">
                                    <li><strong>传输中数据 (In Transit)：</strong> 强制使用 TLS 1.2+ (推崇 TLS 1.3)，弃用所有弱密码套件 (RC4, 3DES 等)，实施 HSTS 并配置完全正向保密 (PFS)。</li>
                                    <li><strong>静止数据 (At Rest)：</strong> 云端 EBS 或对象存储全面应用块级别的 AES-256 加密。主密钥托管于符合 FIPS 140-2 Level 3 级别的联邦云 HSM 硬件模块中集中轮转。</li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-semibold text-foreground border-b border-border pb-1 mb-2">7.3 物理防护措施 (Physical Security)</h4>
                                <ul className="list-disc list-inside text-muted-foreground text-xs space-y-1">
                                    <li>使用 Tier-3 / Tier-4 数据中心。防尾随门禁、7x24 生物识别监控录像、以及对已淘汰硬盘的国标碎磁销毁处理（提供销毁证书）。</li>
                                    <li>ESP32 等硬件私有化探针固化 Secure Boot eFuse，对主板进行滴胶封测，防止侧信道与探测针拔取。</li>
                                </ul>
                            </div>
                            <div>
                                <h4 className="font-semibold text-foreground border-b border-border pb-1 mb-2">7.4 渗透与漏洞管理 (Vulnerability Mgmt)</h4>
                                <ul className="list-disc list-inside text-muted-foreground text-xs space-y-1">
                                    <li>每周进行非破坏性的自动化 DAST 与 SAST 静态代码扫描流水线审计。</li>
                                    <li>每年聘请具有 CREST/OSCP 认证的第三方独立白帽团队对 AetherGuard 系统边界进行“灰盒”渗透测试，并在 NDA 下向高级别客户共享脱敏的测试报告简述。</li>
                                </ul>
                            </div>
                        </div>
                    </Section>

                    {/* Section 8 */}
                    <Section id="sec-8" title="8. 数据泄露通知与联合突发事件管理 (Breach Notification SLA)">
                        <p className="mb-2 text-justify">
                            Aether Studio 承诺，如有确凿证据确认发生了针对我们基础设施的未经授权的访问，并导致您的客户个人数据遭受被证实或极可能的破坏、丢失或非法泄露（即“安全事件”），我们将严格响应：
                        </p>
                        <ul className="list-disc list-inside space-y-2 pl-2">
                            <li><strong>尽责通知限时：</strong> 我们将在意识到并确证安全事件后的 <strong>七十二 (72) 小时内</strong>，毫无无理拖延地正式向客户预留的紧急安全责任人邮箱（CISO联系人）发送事件定性通知信。</li>
                            <li><strong>披露清单：</strong> 通知将包括（且随调查进展不断补充）：(a) 泄露事件的客观性质与成因（0-Day漏洞利用或配置谬误）；(b) 受影响的近乎确切的数据记录种类及数量估算；(c) 我们已采取或将采取的危机挽回操作（如物理断网、BGP 黑洞清洗、系统强制降级）；(d) 减缓您的终端用户风险的行动建议。</li>
                            <li><strong>配合监管声明：</strong> 处理者不具备直接通知该国监管单位（如欧盟各区 DPA 或中国工信部）的授权；我们将完全且免费地配合并准备一切合规报文文件，以便作为控制者的您向上述最高权力机关履行必要的上报义务。</li>
                        </ul>
                    </Section>

                    {/* Section 9 */}
                    <Section id="sec-9" title="9. 数据主体的法定权利 (DSR) 协助义务">
                        <p className="mb-3 text-justify">
                            如果最终用户基于 PIPL、GDPR（第15至22条）或 CCPA 向您发起如数据访问权、更正权、删除权（“被遗忘权”）、限制处理权等请求，而您需要我们的工程协助：
                        </p>
                        <p>
                            通过使用 AetherGuard 内置的管理 API 接口或控制台日志检索 (Log Explorer)，客户可独立、完全地调取与该特定用户标识（如某脱敏 IP 表征或账户名）高度绑定的遥测踪迹并完成数据清洗。若上述功能在客观技术限制下无法通过界面完成，客户可通过客服工单连带法定请求副本一并提交。我们在验证指令合法性后，将于 <strong>三十 (30) 个自然日内</strong> 派遣后台工程师从关系型或冷备分片数据库中进行合规提取或深层物理级核销作业（不收取额外的人工检索费用）。
                        </p>
                    </Section>

                    {/* Section 10 */}
                    <Section id="sec-10" title="10. 客户审计权与合规认证 (Auditing Rights)">
                        <p className="mb-2 text-justify">
                            我们在确保云底座绝对完整的前提下，愿意将安全实施透明化：
                        </p>
                        <ol className="list-decimal list-inside space-y-2 pl-2">
                            <li>依据请求，每年我们将向客户提供最新的通过独立 CPA 事务所背书的 <strong>SOC 2 Type II (关于安全性与可用性)</strong> 鉴证报告，以及 <strong>ISO 27001</strong> 证书副本，用以佐证本 DPA 的履行合规程度是有效且可信的。</li>
                            <li>若上述标准证书仍不足以满足特定区域金融法案的监管压力（例如监管部门发出的直接调查令），则在签署专门的补充保密协议（NDA）及不少于三十日书面排期通知后，客户可指派符合资质的无利益冲突的独立安全审核员对我们的数据处理逻辑执行实地或远程受控环境访谈审计。此项进阶审计每年至多一 (1) 次，且审计全过程不可影响 Aether Studio 系统集群或其他多租户的正常防务运作。</li>
                        </ol>
                    </Section>

                    {/* Section 11 */}
                    <Section id="sec-11" title="11. 数据生命周期及终止/删除指令 (Data Retention & Deletion)">
                        <p className="mb-3">系统生成日志遵循默认衰变曲线：普通拦截流日志存储不超过 30 天，聚合审计长效报表保存 6 至 36 个月（以迎合《中华人民共和国网络安全法》第21条等级保护合规要求）。</p>
                        <p>
                            <strong>解约时的数据物理清算：</strong>一旦您的服务订阅期满且明确指示不再续约，或您主动发出账号注销与退栈请求；本平台在度过三十 (30) 天的保护缓刑期后，将在此后的六十 (60) 天内，以无法在现有计算资源下还原（Cryptographic Erasure / DoD 5220.22-M 介质覆写标准）的方式，对全量客户配置记录及关联日志进行全球物理抹除作业（Cascade Delete）。唯一排除的情形是适用法律以强制效力要求该些文档转入无限期冻结监管状态。
                        </p>
                    </Section>

                    {/* Section 12 */}
                    <Section id="sec-12" title="12. 法定责任限制与争议解决">
                        <div className="bg-muted p-5 border border-border rounded text-sm text-foreground">
                            <p className="mb-4 text-justify font-bold">
                                在任何司法管辖区，我们对因我们违反本 DPA 导致数据泄露的最高赔偿额（包括您由于直接承担监管罚款、数据恢复、终端用户诉讼产生的实质性支出），总体均受限于我们在该索赔事件发生前十二（12）个月内向贵司实质收取的服务费总额度帽限制。此豁免不适用于由我方法定代表人等执行的严重欺诈或故意犯罪引发的恶性泄密。
                            </p>
                            <p className="mt-4 pt-4 border-t border-border">
                                <strong>适用法律管辖：</strong>除由于履行欧盟 SCCs 等硬性冲突规则被移交法院外，本文件的解释与执行将彻底受中华人民共和国法律的管辖；所有未能在双方首席合规官闭门磋商中取得一致化解的根本争端，应单边提交至本公司总部所在地具有司法管辖权的<strong>杭州市西湖区人民法院</strong>提起实质诉讼。
                            </p>
                        </div>
                    </Section>
                </div>

                <div className="mt-16 pt-8 border-t border-border flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
                    <p>文档标记识别代码：MS-DPA-2026-ENT | 等级分类：TLP:WHITE (公开及客户审查)</p>
                    <p>版权所有 © 2026 Aether Studio (杭州视界奇点科技有限公司)。法律事务部编制。</p>
                </div>
            </main>
        </div>
    );
};

// Helper Components
const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <section id={id} className="scroll-mt-24">
        <h2 className="text-xl font-bold text-foreground mb-6 pb-2 border-b border-border">{title}</h2>
        <div className="text-muted-foreground leading-relaxed text-base">{children}</div>
    </section>
);

const SubSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mt-6">
        <h3 className="text-sm font-bold text-foreground mb-2">{title}</h3>
        <div className="text-muted-foreground leading-relaxed text-sm">{children}</div>
    </div>
);

export default PrivacyPolicy;
