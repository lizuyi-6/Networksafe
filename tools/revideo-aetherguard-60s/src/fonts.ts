export async function loadBrandFont(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return;
  const family = 'HarmonyOS Sans SC';
  if (document.fonts.check(`16px "${family}"`)) return;

  const font = new FontFace(
    family,
    'url(/fonts/HarmonyOS_Sans_Regular.ttf) format("truetype")',
    {style: 'normal', weight: '400'},
  );
  await font.load();
  document.fonts.add(font);
  await document.fonts.ready;
}
