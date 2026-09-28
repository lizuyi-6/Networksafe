import {Circle, Img, Layout, Line, Rect, Txt} from '@revideo/2d';
import type {Reference} from '@revideo/core';
import {COLORS} from '../timeline.js';

export function BackgroundGrid() {
  const verticals = Array.from({length: 13}, (_, index) => (
    <Line
      points={[[index * 160 - 960, -540], [index * 160 - 960, 540]]}
      stroke={COLORS.line}
      lineWidth={1}
      opacity={0.22}
    />
  ));
  const horizontals = Array.from({length: 8}, (_, index) => (
    <Line
      points={[[-960, index * 160 - 560], [960, index * 160 - 560]]}
      stroke={COLORS.line}
      lineWidth={1}
      opacity={0.18}
    />
  ));
  return <>{verticals}{horizontals}</>;
}

export function SceneHeader(props: {
  kicker: string;
  headline: string;
  caption: string;
  kickerRef?: Reference<Txt>;
  headlineRef?: Reference<Txt>;
  captionRef?: Reference<Txt>;
  x?: number;
  y?: number;
  width?: number;
  align?: 'left' | 'center' | 'right';
}) {
  const align = props.align ?? 'left';
  const textAlign = align;
  return (
    <Layout
      layout
      direction={'column'}
      gap={24}
      x={props.x ?? -570}
      y={props.y ?? -250}
      width={props.width ?? 720}
      alignItems={align === 'center' ? 'center' : align === 'right' ? 'end' : 'start'}
    >
      <Txt
        ref={props.kickerRef}
        text={props.kicker}
        fill={COLORS.cyan}
        fontFamily={'HarmonyOS Sans SC'}
        fontSize={25}
        fontWeight={700}
        letterSpacing={7}
        textAlign={textAlign}
        opacity={0}
      />
      <Txt
        ref={props.headlineRef}
        text={props.headline}
        fill={COLORS.text}
        fontFamily={'HarmonyOS Sans SC'}
        fontSize={68}
        fontWeight={700}
        lineHeight={'122%'}
        textWrap={true}
        width={props.width ?? 720}
        textAlign={textAlign}
        opacity={0}
      />
      <Txt
        ref={props.captionRef}
        text={props.caption}
        fill={COLORS.textSoft}
        fontFamily={'HarmonyOS Sans SC'}
        fontSize={29}
        fontWeight={400}
        lineHeight={'150%'}
        textWrap={true}
        width={props.width ?? 720}
        textAlign={textAlign}
        opacity={0}
      />
    </Layout>
  );
}

export function EvidenceCard(props: {
  src: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ref?: Reference<Rect>;
  accent?: string;
}) {
  return (
    <Rect
      ref={props.ref}
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      radius={26}
      fill={COLORS.surface}
      stroke={props.accent ?? COLORS.cyan}
      lineWidth={2}
      clip
      opacity={0}
      scale={0.94}
      shadowColor={'#00000099'}
      shadowBlur={36}
      shadowOffsetY={18}
    >
      <Img
        src={props.src}
        width={props.width}
        height={props.height}
        smoothing
      />
      <Rect
        width={props.width}
        height={82}
        y={props.height / 2 - 41}
        fill={'#050B14E8'}
      >
        <Txt
          text={props.label}
          x={-props.width / 2 + 36}
          fill={COLORS.text}
          fontFamily={'HarmonyOS Sans SC'}
          fontSize={24}
          fontWeight={600}
          textAlign={'left'}
        />
        <Txt
          text={'演示界面 · 示例数据'}
          x={props.width / 2 - 160}
          fill={COLORS.amber}
          fontFamily={'HarmonyOS Sans SC'}
          fontSize={20}
          fontWeight={600}
          textAlign={'right'}
        />
      </Rect>
    </Rect>
  );
}

export function StatusChip(props: {
  text: string;
  x: number;
  y: number;
  color: string;
  ref?: Reference<Rect>;
  width?: number;
}) {
  return (
    <Rect
      ref={props.ref}
      x={props.x}
      y={props.y}
      width={props.width ?? 214}
      height={64}
      radius={18}
      fill={`${props.color}1D`}
      stroke={props.color}
      lineWidth={2}
      opacity={0}
      scale={0.88}
    >
      <Circle x={-70} size={12} fill={props.color} />
      <Txt
        text={props.text}
        x={12}
        fill={COLORS.text}
        fontFamily={'HarmonyOS Sans SC'}
        fontSize={24}
        fontWeight={600}
      />
    </Rect>
  );
}

export function ModuleCard(props: {
  code: string;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  ref?: Reference<Rect>;
  color?: string;
}) {
  const color = props.color ?? COLORS.cyan;
  return (
    <Rect
      ref={props.ref}
      x={props.x}
      y={props.y}
      width={330}
      height={156}
      radius={24}
      fill={COLORS.surfaceSoft}
      stroke={color}
      lineWidth={2}
      opacity={0}
      scale={0.92}
    >
      <Rect x={-124} width={58} height={58} radius={16} fill={`${color}2A`}>
        <Txt text={props.code} fill={color} fontFamily={'HarmonyOS Sans SC'} fontSize={24} fontWeight={700} />
      </Rect>
      <Txt
        text={props.title}
        x={22}
        y={-28}
        width={230}
        fill={COLORS.text}
        fontFamily={'HarmonyOS Sans SC'}
        fontSize={27}
        fontWeight={650}
        textAlign={'left'}
      />
      <Txt
        text={props.subtitle}
        x={22}
        y={27}
        width={230}
        fill={COLORS.textSoft}
        fontFamily={'HarmonyOS Sans SC'}
        fontSize={19}
        fontWeight={400}
        textAlign={'left'}
      />
    </Rect>
  );
}

export function BoundaryLabel(props: {text: string; x: number; y: number; color?: string}) {
  const color = props.color ?? COLORS.textSoft;
  return (
    <Txt
      text={props.text}
      x={props.x}
      y={props.y}
      fill={color}
      fontFamily={'HarmonyOS Sans SC'}
      fontSize={20}
      fontWeight={600}
      letterSpacing={2}
    />
  );
}
