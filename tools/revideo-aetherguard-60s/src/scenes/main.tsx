import {Audio, Circle, Img, Layout, Line, Rect, Txt, makeScene2D} from '@revideo/2d';
import {
  all,
  chain,
  createRef,
  delay,
  easeInOutCubic,
  easeOutCubic,
  spawn,
  useTime,
  waitFor,
  type ThreadGenerator,
} from '@revideo/core';
import {
  BackgroundGrid,
  BoundaryLabel,
  EvidenceCard,
  ModuleCard,
  SceneHeader,
  StatusChip,
} from '../components/film.js';
import {loadBrandFont} from '../fonts.js';
import {ASSETS, COLORS, DURATION_SECONDS, SEGMENTS} from '../timeline.js';

function* segmentFade(root: ReturnType<typeof createRef<Layout>>, duration: number): ThreadGenerator {
  yield* chain(
    root().opacity(1, 0.65, easeOutCubic),
    waitFor(duration - 1.3),
    root().opacity(0, 0.65, easeInOutCubic),
  );
}

export default makeScene2D('aetherguard-main', function* (view) {
  view.fill(COLORS.background);
  yield loadBrandFont();

  const ambient = createRef<Layout>();
  const driftA = createRef<Circle>();
  const driftB = createRef<Circle>();
  const scanline = createRef<Line>();
  yield view.add(
    <Layout ref={ambient} layout={false} width={'100%'} height={'100%'}>
      <Audio src={'/audio/narration-60s.wav'} play={true} time={0} volume={1} />
      <Circle ref={driftA} x={-820} y={-380} size={900} fill={'#22D3EE09'} />
      <Circle ref={driftB} x={820} y={420} size={760} fill={'#F59E0B08'} />
      <Line ref={scanline} points={[[-960, -500], [960, -500]]} stroke={COLORS.cyan} lineWidth={2} opacity={0.18} />
    </Layout>,
  );
  spawn(function* () {
    yield* all(
      driftA().x(700, DURATION_SECONDS),
      driftA().y(320, DURATION_SECONDS),
      driftB().x(-620, DURATION_SECONDS),
      driftB().y(-300, DURATION_SECONDS),
      scanline().y(500, DURATION_SECONDS),
    );
  });

  {
    const root = createRef<Layout>();
    const kicker = createRef<Txt>();
    const headline = createRef<Txt>();
    const caption = createRef<Txt>();
    const server = createRef<Rect>();
    const pulse = createRef<Circle>();
    const rootBadge = createRef<Rect>();

    yield view.add(
      <Layout ref={root} layout={false} width={'100%'} height={'100%'} opacity={0}>
        <BackgroundGrid />
        <Circle x={610} y={-230} size={700} fill={'#F43F5E12'} />
        <SceneHeader
          kicker={'THREAT MODEL'}
          headline={'当服务器取得最高权限'}
          caption={'主机内的代理、防火墙和日志，可能同时落入失陷的信任域。'}
          kickerRef={kicker}
          headlineRef={headline}
          captionRef={caption}
        />
        <Rect
          ref={server}
          x={560}
          y={0}
          width={560}
          height={620}
          radius={38}
          fill={COLORS.surface}
          stroke={COLORS.red}
          lineWidth={3}
          scale={0.9}
        >
          <Txt text={'SERVER'} y={-245} fill={COLORS.textSoft} fontFamily={'HarmonyOS Sans SC'} fontSize={22} fontWeight={700} letterSpacing={6} />
          {[-130, 0, 130].map((y, index) => (
            <Rect key={`host-layer-${index}`} y={y} width={430} height={92} radius={18} fill={'#17263A'} stroke={COLORS.red} lineWidth={2}>
              <Circle x={-165} size={14} fill={COLORS.red} />
              <Txt
                text={['Agent / EDR', 'Firewall / Policy', 'Logs / Audit'][index]}
                x={20}
                width={300}
                fill={COLORS.text}
                fontFamily={'HarmonyOS Sans SC'}
                fontSize={25}
                fontWeight={550}
                textAlign={'left'}
              />
            </Rect>
          ))}
          <Rect ref={rootBadge} y={244} width={280} height={76} radius={22} fill={'#F43F5E24'} stroke={COLORS.red} lineWidth={2} scale={0.7} opacity={0}>
            <Txt text={'ROOT ACCESS'} fill={COLORS.red} fontFamily={'HarmonyOS Sans SC'} fontSize={26} fontWeight={800} letterSpacing={3} />
          </Rect>
        </Rect>
        <Circle ref={pulse} x={560} size={60} fill={'#F43F5E00'} stroke={COLORS.red} lineWidth={5} opacity={0} />
        <Txt
          text={'威胁模型：主机 OS / Agent / 日志可能失陷'}
          x={-560}
          y={438}
          width={720}
          fill={COLORS.amber}
          fontFamily={'HarmonyOS Sans SC'}
          fontSize={20}
          fontWeight={600}
          textAlign={'left'}
        />
      </Layout>,
    );

    yield* all(
      segmentFade(root, SEGMENTS.breach),
      delay(0.15, kicker().opacity(1, 0.45)),
      delay(0.35, headline().opacity(1, 0.55)),
      delay(0.65, caption().opacity(1, 0.55)),
      delay(0.25, server().scale(1, 0.7, easeOutCubic)),
      delay(1.45, rootBadge().opacity(1, 0.35)),
      delay(1.45, rootBadge().scale(1, 0.45, easeOutCubic)),
      delay(1.55, all(pulse().opacity(0.85, 0.2), pulse().size(760, 1.8, easeOutCubic), pulse().opacity(0, 1.8))),
    );
    root().remove();
  }

  {
    const root = createRef<Layout>();
    const serverBoundary = createRef<Rect>();
    const externalBoundary = createRef<Rect>();
    const dataLine = createRef<Line>();
    const transferDot = createRef<Circle>();
    const boundarySweep = createRef<Line>();
    const gate = createRef<Rect>();
    const serverTitle = createRef<Txt>();
    const externalTitle = createRef<Txt>();

    yield view.add(
      <Layout ref={root} layout={false} width={'100%'} height={'100%'} opacity={0}>
        <BackgroundGrid />
        <Line ref={boundarySweep} points={[[0, -500], [0, 500]]} x={-850} stroke={COLORS.cyan} lineWidth={3} opacity={0.16} />
        <Txt x={0} y={-418} text={'把最终授权边界移出服务器'} fill={COLORS.text} fontFamily={'HarmonyOS Sans SC'} fontSize={70} fontWeight={700} />
        <Txt x={0} y={-335} text={'检测与响应留在控制平面，最终释放由服务器外的边界约束。'} fill={COLORS.textSoft} fontFamily={'HarmonyOS Sans SC'} fontSize={28} />
        <Rect ref={serverBoundary} x={-450} y={80} width={670} height={560} radius={44} fill={'#0D1B2DCC'} stroke={COLORS.red} lineWidth={3} scale={0.9}>
          <Txt ref={serverTitle} text={'SERVER TRUST DOMAIN'} y={-222} fill={COLORS.red} fontFamily={'HarmonyOS Sans SC'} fontSize={24} fontWeight={700} letterSpacing={4} opacity={0} />
          {['Agent', 'Detection', 'Response', 'Audit'].map((label, index) => (
            <Rect key={label} x={(index % 2) * 250 - 125} y={Math.floor(index / 2) * 150 - 70} width={220} height={105} radius={20} fill={'#17263A'} stroke={'#334155'} lineWidth={2}>
              <Txt text={label} fill={COLORS.text} fontFamily={'HarmonyOS Sans SC'} fontSize={25} fontWeight={550} />
            </Rect>
          ))}
        </Rect>
        <Rect ref={externalBoundary} x={500} y={80} width={590} height={560} radius={44} fill={'#071D2ACC'} stroke={COLORS.cyan} lineWidth={3} scale={0.9}>
          <Txt ref={externalTitle} text={'EXTERNAL CONTROL BOUNDARY'} y={-222} fill={COLORS.cyan} fontFamily={'HarmonyOS Sans SC'} fontSize={23} fontWeight={700} letterSpacing={3} opacity={0} />
          <Img src={ASSETS.logo} width={210} height={210} y={-65} />
          <Rect ref={gate} y={120} width={330} height={102} radius={22} fill={'#F59E0B1B'} stroke={COLORS.amber} lineWidth={3} scale={0.72}>
            <Txt text={'HARDWARE GRANT'} fill={COLORS.amber} fontFamily={'HarmonyOS Sans SC'} fontSize={28} fontWeight={750} letterSpacing={2} />
          </Rect>
        </Rect>
        <Line ref={dataLine} points={[[-115, 70], [165, 70]]} stroke={COLORS.cyan} lineWidth={14} end={0} endArrow arrowSize={28} />
        <Circle ref={transferDot} x={-115} y={70} size={34} fill={COLORS.amber} opacity={0} />
        <Txt
          text={'AetherGuard 不替代 WAF、EDR 或堡垒机'}
          x={0}
          y={448}
          fill={COLORS.amber}
          fontFamily={'HarmonyOS Sans SC'}
          fontSize={21}
          fontWeight={650}
        />
      </Layout>,
    );

    spawn(function* () {
      yield* waitFor(2.2);
      yield* boundarySweep().x(850, 5.2, easeInOutCubic);
    });

    spawn(function* () {
      yield* waitFor(2.4);
      for (let pass = 0; pass < 2; pass++) {
        yield* all(
          serverBoundary().scale(1.015, 1.05, easeInOutCubic),
          externalBoundary().scale(1.015, 1.05, easeInOutCubic),
        );
        yield* all(
          serverBoundary().scale(1, 1.05, easeInOutCubic),
          externalBoundary().scale(1, 1.05, easeInOutCubic),
        );
      }
    });

    spawn(function* () {
      yield* waitFor(2.6);
      for (let pass = 0; pass < 3; pass++) {
        transferDot().x(-115);
        yield* all(
          transferDot().opacity(1, 0.18),
          transferDot().x(165, 1.4, easeInOutCubic),
        );
        yield* transferDot().opacity(0, 0.2);
      }
    });

    yield* all(
      segmentFade(root, SEGMENTS.boundary),
      serverBoundary().scale(1, 0.7, easeOutCubic),
      externalBoundary().scale(1, 0.7, easeOutCubic),
      delay(0.35, serverTitle().opacity(1, 0.4)),
      delay(0.55, externalTitle().opacity(1, 0.4)),
      delay(1.2, dataLine().end(1, 1.1, easeInOutCubic)),
      delay(2.0, gate().scale(1, 0.5, easeOutCubic)),
    );
    root().remove();
  }

  {
    const root = createRef<Layout>();
    const kicker = createRef<Txt>();
    const headline = createRef<Txt>();
    const caption = createRef<Txt>();
    const dashboard = createRef<Rect>();
    const traffic = createRef<Rect>();
    const history = createRef<Rect>();

    yield view.add(
      <Layout ref={root} layout={false} width={'100%'} height={'100%'} opacity={0}>
        <BackgroundGrid />
        <SceneHeader
          kicker={'CONTROL PLANE'}
          headline={'风险与证据\n进入同一视图'}
          caption={'统一呈现流量、事件、告警、设备与处置状态。'}
          kickerRef={kicker}
          headlineRef={headline}
          captionRef={caption}
          x={-590}
          y={-205}
          width={600}
        />
        <EvidenceCard ref={dashboard} src={ASSETS.dashboard} label={'Global Dashboard'} x={470} y={-90} width={780} height={585} accent={COLORS.cyan} />
        <EvidenceCard ref={traffic} src={ASSETS.traffic} label={'Traffic Evidence'} x={185} y={270} width={470} height={352} accent={COLORS.blue} />
        <EvidenceCard ref={history} src={ASSETS.history} label={'Audit Timeline'} x={690} y={300} width={470} height={352} accent={COLORS.mint} />
      </Layout>,
    );

    spawn(function* () {
      yield* waitFor(2.8);
      for (let pass = 0; pass < 2; pass++) {
        yield* all(
          dashboard().y(-100, 1.1, easeInOutCubic),
          traffic().y(260, 1.1, easeInOutCubic),
          history().y(290, 1.1, easeInOutCubic),
        );
        yield* all(
          dashboard().y(-90, 1.1, easeInOutCubic),
          traffic().y(270, 1.1, easeInOutCubic),
          history().y(300, 1.1, easeInOutCubic),
        );
      }
    });

    yield* all(
      segmentFade(root, SEGMENTS.evidence),
      delay(0.15, kicker().opacity(1, 0.4)),
      delay(0.35, headline().opacity(1, 0.55)),
      delay(0.65, caption().opacity(1, 0.5)),
      delay(0.3, all(dashboard().opacity(1, 0.6), dashboard().scale(1, 0.6, easeOutCubic))),
      delay(1.3, all(traffic().opacity(1, 0.55), traffic().scale(1, 0.55, easeOutCubic))),
      delay(2.05, all(history().opacity(1, 0.55), history().scale(1, 0.55, easeOutCubic))),
    );
    root().remove();
  }

  {
    const root = createRef<Layout>();
    const monitor = createRef<Rect>();
    const analysis = createRef<Rect>();
    const debate = createRef<Rect>();
    const synthesis = createRef<Rect>();
    const audit = createRef<Rect>();
    const flow = createRef<Line>();

    yield view.add(
      <Layout ref={root} layout={false} width={'100%'} height={'100%'} opacity={0}>
        <BackgroundGrid />
        <Txt x={-650} y={-405} text={'ASSISTED DECISION'} fill={COLORS.cyan} fontFamily={'HarmonyOS Sans SC'} fontSize={24} fontWeight={700} letterSpacing={6} />
        <Txt x={-410} y={-315} width={1040} text={'让判断过程可以被检查'} fill={COLORS.text} fontFamily={'HarmonyOS Sans SC'} fontSize={68} fontWeight={700} textAlign={'left'} />
        <EvidenceCard ref={monitor} src={ASSETS.agents} label={'Seven-layer Agent Monitor'} x={510} y={90} width={700} height={525} accent={COLORS.blue} />
        <StatusChip ref={analysis} text={'角色分析'} x={-650} y={-100} color={COLORS.cyan} />
        <StatusChip ref={debate} text={'冲突辩论'} x={-380} y={-100} color={COLORS.amber} />
        <StatusChip ref={synthesis} text={'案例综合'} x={-650} y={20} color={COLORS.blue} />
        <StatusChip ref={audit} text={'审计追溯'} x={-380} y={20} color={COLORS.mint} />
        <Line ref={flow} points={[[-710, 180], [-320, 180], [-120, 180]]} stroke={COLORS.cyan} lineWidth={9} end={0} endArrow arrowSize={24} />
        <Txt
          text={'架构与原型已实现 · 不宣称未经量化的准确率提升'}
          x={-445}
          y={270}
          width={700}
          fill={COLORS.amber}
          fontFamily={'HarmonyOS Sans SC'}
          fontSize={22}
          fontWeight={600}
          textAlign={'left'}
        />
      </Layout>,
    );

    yield* all(
      segmentFade(root, SEGMENTS.agents),
      delay(0.25, all(monitor().opacity(1, 0.65), monitor().scale(1, 0.65, easeOutCubic))),
      delay(0.6, all(analysis().opacity(1, 0.35), analysis().scale(1, 0.35, easeOutCubic))),
      delay(1.1, all(debate().opacity(1, 0.35), debate().scale(1, 0.35, easeOutCubic))),
      delay(1.6, all(synthesis().opacity(1, 0.35), synthesis().scale(1, 0.35, easeOutCubic))),
      delay(2.1, all(audit().opacity(1, 0.35), audit().scale(1, 0.35, easeOutCubic))),
      delay(2.6, flow().end(1, 1.0, easeInOutCubic)),
    );
    root().remove();
  }

  {
    const root = createRef<Layout>();
    const appliance = createRef<Rect>();
    const m1 = createRef<Rect>();
    const m2 = createRef<Rect>();
    const m3 = createRef<Rect>();
    const m4 = createRef<Rect>();
    const serverLine = createRef<Line>();
    const lanLine = createRef<Line>();
    const mgmtLine = createRef<Line>();

    yield view.add(
      <Layout ref={root} layout={false} width={'100%'} height={'100%'} opacity={0}>
        <BackgroundGrid />
        <Txt x={-650} y={-420} text={'GATEWAY APPLIANCE'} fill={COLORS.cyan} fontFamily={'HarmonyOS Sans SC'} fontSize={24} fontWeight={700} letterSpacing={6} />
        <Txt x={-425} y={-330} width={1080} text={'关键释放权，交给外置网关'} fill={COLORS.text} fontFamily={'HarmonyOS Sans SC'} fontSize={66} fontWeight={700} textAlign={'left'} />
        <Rect ref={appliance} x={-520} y={100} width={760} height={540} radius={34} fill={'#0D1B2D'} stroke={COLORS.cyan} lineWidth={2} clip opacity={0} scale={0.9}>
          <Img src={ASSETS.appliance} width={756} height={540} smoothing />
          <Rect y={224} width={760} height={92} fill={'#050B14E8'}>
            <Txt text={'Phase 0.x 工业硬件原型渲染 · 非量产设备'} fill={COLORS.amber} fontFamily={'HarmonyOS Sans SC'} fontSize={22} fontWeight={650} />
          </Rect>
        </Rect>
        <ModuleCard ref={m1} code={'M1'} title={'Gateway'} subtitle={'透明桥与规则执行'} x={320} y={-75} color={COLORS.cyan} />
        <ModuleCard ref={m2} code={'M2'} title={'Controller'} subtitle={'独立授权状态机'} x={690} y={-75} color={COLORS.blue} />
        <ModuleCard ref={m3} code={'M3'} title={'Secure Element'} subtitle={'设备身份与密钥'} x={320} y={125} color={COLORS.amber} />
        <ModuleCard ref={m4} code={'M4'} title={'Interlock'} subtitle={'Fail-closed + feedback'} x={690} y={125} color={COLORS.mint} />
        <Line ref={serverLine} points={[[-830, 385], [-620, 385]]} stroke={COLORS.red} lineWidth={12} end={0} endArrow arrowSize={24} />
        <Line ref={lanLine} points={[[-420, 385], [-210, 385]]} stroke={COLORS.cyan} lineWidth={12} end={0} endArrow arrowSize={24} />
        <Line ref={mgmtLine} points={[[-520, 385], [-520, 490]]} stroke={COLORS.amber} lineWidth={9} end={0} endArrow arrowSize={22} />
        <BoundaryLabel text={'SERVER'} x={-875} y={440} color={COLORS.red} />
        <BoundaryLabel text={'LAN / WAN'} x={-160} y={440} color={COLORS.cyan} />
        <BoundaryLabel text={'MGMT'} x={-520} y={510} color={COLORS.amber} />
      </Layout>,
    );

    yield* all(
      segmentFade(root, SEGMENTS.appliance),
      delay(0.25, all(appliance().opacity(1, 0.7), appliance().scale(1, 0.7, easeOutCubic))),
      delay(0.8, serverLine().end(1, 0.7, easeInOutCubic)),
      delay(1.2, lanLine().end(1, 0.7, easeInOutCubic)),
      delay(1.6, mgmtLine().end(1, 0.7, easeInOutCubic)),
      delay(2.0, all(m1().opacity(1, 0.4), m1().scale(1, 0.4, easeOutCubic))),
      delay(2.5, all(m2().opacity(1, 0.4), m2().scale(1, 0.4, easeOutCubic))),
      delay(3.0, all(m3().opacity(1, 0.4), m3().scale(1, 0.4, easeOutCubic))),
      delay(3.5, all(m4().opacity(1, 0.4), m4().scale(1, 0.4, easeOutCubic))),
    );
    root().remove();
  }

  {
    const root = createRef<Layout>();
    const signature = createRef<Rect>();
    const challenge = createRef<Rect>();
    const expiry = createRef<Rect>();
    const counter = createRef<Rect>();
    const feedback = createRef<Rect>();
    const gate = createRef<Rect>();
    const reject = createRef<Rect>();
    const releaseLine = createRef<Line>();

    yield view.add(
      <Layout ref={root} layout={false} width={'100%'} height={'100%'} opacity={0}>
        <BackgroundGrid />
        <Txt x={0} y={-420} text={'任一校验失败，保持隔离'} fill={COLORS.text} fontFamily={'HarmonyOS Sans SC'} fontSize={72} fontWeight={700} />
        <Txt x={0} y={-340} text={'FAIL-CLOSED · RELEASE IS TEMPORARY · ISOLATION IS THE DEFAULT'} fill={COLORS.red} fontFamily={'HarmonyOS Sans SC'} fontSize={22} fontWeight={700} letterSpacing={3} />
        <StatusChip ref={signature} text={'签名'} x={-660} y={-100} color={COLORS.cyan} width={200} />
        <StatusChip ref={challenge} text={'Challenge'} x={-420} y={-100} color={COLORS.cyan} width={220} />
        <StatusChip ref={expiry} text={'有效期'} x={-160} y={-100} color={COLORS.cyan} width={200} />
        <StatusChip ref={counter} text={'计数器'} x={80} y={-100} color={COLORS.cyan} width={200} />
        <StatusChip ref={feedback} text={'Feedback'} x={320} y={-100} color={COLORS.cyan} width={220} />
        <Line ref={releaseLine} points={[[-690, 55], [400, 55], [560, 55]]} stroke={COLORS.cyan} lineWidth={10} end={0} endArrow arrowSize={26} />
        <Rect ref={gate} x={650} y={55} width={320} height={178} radius={28} fill={'#10B9811A'} stroke={COLORS.mint} lineWidth={3} opacity={0} scale={0.85}>
          <Txt text={'RELEASED'} y={-25} fill={COLORS.mint} fontFamily={'HarmonyOS Sans SC'} fontSize={34} fontWeight={800} letterSpacing={3} />
          <Txt text={'暂态授权窗口'} y={32} fill={COLORS.textSoft} fontFamily={'HarmonyOS Sans SC'} fontSize={22} />
        </Rect>
        <Rect ref={reject} y={250} width={780} height={144} radius={28} fill={'#F43F5E1D'} stroke={COLORS.red} lineWidth={3} opacity={0} scale={0.88}>
          <Txt text={'VALIDATION FAILED  →  ISOLATED'} y={-24} fill={COLORS.red} fontFamily={'HarmonyOS Sans SC'} fontSize={32} fontWeight={800} letterSpacing={2} />
          <Txt text={'受控业务桥保持隔离 · 独立 MGMT 通道保留恢复能力'} y={30} fill={COLORS.text} fontFamily={'HarmonyOS Sans SC'} fontSize={23} />
        </Rect>
      </Layout>,
    );

    yield* all(
      segmentFade(root, SEGMENTS.failClosed),
      delay(0.35, all(signature().opacity(1, 0.25), signature().scale(1, 0.25, easeOutCubic))),
      delay(0.75, all(challenge().opacity(1, 0.25), challenge().scale(1, 0.25, easeOutCubic))),
      delay(1.15, all(expiry().opacity(1, 0.25), expiry().scale(1, 0.25, easeOutCubic))),
      delay(1.55, all(counter().opacity(1, 0.25), counter().scale(1, 0.25, easeOutCubic))),
      delay(1.95, all(feedback().opacity(1, 0.25), feedback().scale(1, 0.25, easeOutCubic))),
      delay(2.35, releaseLine().end(1, 0.9, easeInOutCubic)),
      delay(3.0, all(gate().opacity(1, 0.3), gate().scale(1, 0.3, easeOutCubic))),
      delay(4.1, all(gate().opacity(0.18, 0.25), reject().opacity(1, 0.35), reject().scale(1, 0.35, easeOutCubic))),
    );
    root().remove();
  }

  {
    const root = createRef<Layout>();
    const logo = createRef<Img>();
    const halo = createRef<Circle>();
    const sweep = createRef<Line>();
    const title = createRef<Txt>();
    const subtitle = createRef<Txt>();
    const boundary = createRef<Txt>();

    yield view.add(
      <Layout ref={root} layout={false} width={'100%'} height={'100%'} opacity={0}>
        <BackgroundGrid />
        <Circle ref={halo} size={920} fill={'#22D3EE0D'} />
        <Line ref={sweep} points={[[-140, -520], [140, 520]]} x={-980} stroke={COLORS.cyan} lineWidth={5} opacity={0.18} />
        <Img ref={logo} src={ASSETS.logo} x={-520} width={340} height={340} opacity={0} scale={0.8} />
        <Txt
          ref={title}
          x={250}
          y={-80}
          width={1100}
          text={'把最后的授权边界\n推向服务器之外'}
          fill={COLORS.text}
          fontFamily={'HarmonyOS Sans SC'}
          fontSize={78}
          fontWeight={750}
          lineHeight={'124%'}
          textAlign={'left'}
          opacity={0}
        />
        <Txt ref={subtitle} x={15} y={225} width={1500} text={'AetherGuard · Root-Resistant Final Defense · EXPERIMENTAL'} fill={COLORS.cyan} fontFamily={'HarmonyOS Sans SC'} fontSize={27} fontWeight={700} letterSpacing={2} opacity={0} />
        <Txt ref={boundary} x={15} y={315} width={1500} text={'当前为工业硬件原型 · 仅覆盖实际接入网关的受控网络链路'} fill={COLORS.amber} fontFamily={'HarmonyOS Sans SC'} fontSize={23} fontWeight={600} opacity={0} />
      </Layout>,
    );

    spawn(function* () {
      yield* waitFor(1.4);
      yield* sweep().x(980, 5.0, easeInOutCubic);
    });

    spawn(function* () {
      yield* waitFor(1.8);
      for (let pass = 0; pass < 2; pass++) {
        yield* all(
          halo().size(970, 1.15, easeInOutCubic),
          logo().scale(1.025, 1.15, easeInOutCubic),
        );
        yield* all(
          halo().size(920, 1.15, easeInOutCubic),
          logo().scale(1, 1.15, easeInOutCubic),
        );
      }
    });

    yield* all(
      segmentFade(root, SEGMENTS.outro),
      all(logo().opacity(1, 0.7), logo().scale(1, 0.7, easeOutCubic)),
      delay(0.35, title().opacity(1, 0.7)),
      delay(0.75, subtitle().opacity(1, 0.55)),
      delay(1.05, boundary().opacity(1, 0.55)),
    );
    root().remove();
  }

  ambient().remove();
  const remaining = DURATION_SECONDS - useTime();
  if (remaining < -0.001) {
    throw new Error(`Main scene exceeded ${DURATION_SECONDS}s by ${Math.abs(remaining).toFixed(3)}s`);
  }
  if (remaining > 0) {
    yield* waitFor(remaining);
  }
});
