# Draws the animated PlotFolio icon: the app icon with fumes rising from its two craters, for web pages.
#
#   python3 scripts/make-animated-icon.py [icon.png] [out.svg] [setting=value ...]
#
# Without arguments: docs/icon/plotfolio-icon-512.png (the icon WITHOUT fumes, 512 px, the tile with the margin
#                    macOS icons have; the apps' own icon files may carry the still fumes, so they are not used)
#                    -> docs/icon/plotfolio-icon-animated.svg
# The look of the fumes is set in scripts/make-icon.py, which draws the same fumes standing still. A setting can
# also be given on the command line to try another look, in small letters:
#   python3 scripts/make-animated-icon.py docs/icon/plotfolio-icon-512.png try.svg puffs=13 opacity=0.95 rise=3.0,3.7
#
# The result is one file: the icon picture is embedded, the fumes are a few soft circles moved by CSS inside the
# SVG. So it works wherever a picture does (<img src="...svg">), and needs nothing from the page around it.
# Readers who ask their system for reduced motion get the still icon.
#
# Each puff is born small inside a crater, rises, widens, drifts with a light wind to the right and fades.
# The craters' places come from scripts/make-icon.py, so the fumes follow if the volcanoes are ever moved.
import ast, base64, importlib.util, os, random, sys

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('make_icon', os.path.join(here, 'make-icon.py'))
make_icon = importlib.util.module_from_spec(spec); spec.loader.exec_module(make_icon)

paths = [a for a in sys.argv[1:] if '=' not in a]
png = paths[0] if len(paths) > 0 else os.path.join(here, '..', 'docs', 'icon', 'plotfolio-icon-512.png')
out = paths[1] if len(paths) > 1 else os.path.join(here, '..', 'docs', 'icon', 'plotfolio-icon-animated.svg')

SECONDS = 6.5             # the life of one puff over the large crater
PUFFS, RISE, DRIFT, GROW, OPACITY = make_icon.PUFFS, make_icon.RISE, make_icon.DRIFT, make_icon.GROW, make_icon.OPACITY
FUME, GLOW, gradient = make_icon.FUME, make_icon.GLOW, make_icon.gradient

for name, value in (a.split('=', 1) for a in sys.argv[1:] if '=' in a):   # settings given on the command line
    if name.upper() not in ('PUFFS', 'SECONDS', 'RISE', 'DRIFT', 'GROW', 'OPACITY'): sys.exit('no such setting: ' + name)
    globals()[name.upper()] = ast.literal_eval(value)

rnd = random.Random(7)    # the same puffs every time the script runs
def between(lo, hi): return lo + (hi - lo) * rnd.random()

rims = make_icon.craters()
widest = max(r[2] for r in rims)
fumes = ''
for k, (cx, cy, rx, ry) in enumerate(rims):
    size = rx / widest                                    # 1 for the large crater
    n = max(3, round(PUFFS * size)); life = SECONDS * (0.8 + 0.2 * size)
    fumes += f'<ellipse class="glow" cx="{cx:.1f}" cy="{cy + ry * 0.2:.1f}" rx="{rx * 0.78:.1f}" ry="{ry * 0.72:.1f}" fill="url(#glow)" style="animation-delay:-{k * 1.3:.1f}s"/>'
    for i in range(n):
        style = (f'--dx:{between(*DRIFT) * rx:.0f}px;--dy:-{between(*RISE) * rx:.0f}px;--w:{between(-0.25, 0.25) * rx:.0f}px;'
                 f'--s:{between(*GROW):.2f};--o:{OPACITY * (0.8 + 0.2 * size):.2f};'
                 f'animation-duration:{life * between(0.92, 1.08):.2f}s;animation-delay:-{life * (i + between(0, 0.5)) / n:.2f}s')
        fumes += (f'<g transform="translate({cx + between(-0.2, 0.2) * rx:.1f} {cy + ry * 0.15:.1f})">'
                  f'<circle class="puff" r="{rx * between(0.38, 0.48):.1f}" fill="url(#fume)" style="{style}"/></g>')

css = '''
.puff{opacity:0;animation:rise 6.5s linear infinite}
.glow{opacity:.3;animation:glow 3.4s ease-in-out infinite alternate}
@keyframes rise{
  0%{transform:translate(0,0) scale(.35);opacity:0}
  12%{opacity:var(--o)}
  35%{transform:translate(calc(var(--dx)*.18 + var(--w)),calc(var(--dy)*.38)) scale(calc(var(--s)*.5))}
  60%{opacity:calc(var(--o)*.55)}
  70%{transform:translate(calc(var(--dx)*.55 - var(--w)*.6),calc(var(--dy)*.74)) scale(calc(var(--s)*.8))}
  100%{transform:translate(var(--dx),var(--dy)) scale(var(--s));opacity:0}
}
@keyframes glow{from{opacity:.12}to{opacity:.5}}
@media (prefers-reduced-motion:reduce){.puff{animation:none;opacity:0}.glow{animation:none;opacity:.25}}
'''.replace('\n', '').replace('  ', '')

picture = base64.b64encode(open(png, 'rb').read()).decode()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="The PlotFolio icon: two volcanoes drawn as a 3D surface, fuming">'
       '<title>PlotFolio</title>'
       f'<defs>{gradient("fume", FUME)}{gradient("glow", GLOW)}'
       '<clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>'
       f'<style>{css}</style></defs>'
       f'<image width="1024" height="1024" href="data:image/png;base64,{picture}"/>'
       f'<g clip-path="url(#tile)">{fumes}</g></svg>\n')
open(out, 'w').write(svg)
print('wrote', os.path.normpath(out), f'({len(svg) // 1024} kB)')
