# Draws the PlotFolio app icon: two volcanoes as a 3D surface on a graphite tile.
#
#   python3 scripts/make-icon.py docs/icon
#
# writes four SVG files, 1024 x 1024:
#   plotfolio-icon.svg             the tile with the margin macOS icons have        -> icon.icns and the plain PNGs
#   plotfolio-icon-full.svg        the same tile filling the whole square (Windows) -> icon.ico, Square*Logo.png, favicon
#   plotfolio-icon-fumes.svg       \ the same two, with fumes standing over the craters: the moving fumes of the
#   plotfolio-icon-fumes-full.svg  / animated icon (scripts/make-animated-icon.py), caught in one moment
# The apps, the browser tab and the README carry the icon WITH the fumes. Their icon files are made by Tauri's own
# tool, into a scratch folder, and copied to src-tauri/icons (the tool also writes phone icons that PlotFolio has
# no use for):
#   npx tauri icon docs/icon/plotfolio-icon-fumes.svg      -o <scratch>/mac   -> icon.icns icon.png 32x32.png 128x128.png 128x128@2x.png
#   npx tauri icon docs/icon/plotfolio-icon-fumes-full.svg -o <scratch>/win   -> icon.ico Square*Logo.png StoreLogo.png
# then <scratch>/win/64x64.png -> public/favicon.png, <scratch>/mac/128x128@2x.png -> docs/readme/icon.png, and
# python3 scripts/make-readme-art.py docs/readme (the Mac install strip shows the icon).
# The icon without fumes stays in docs/icon/plotfolio-icon-512.png: the animated icon is built on it.
#
# The surface is a function of x and y (two cones with craters), cut into a grid of facets. Each facet is
# colored by its height (a ramp from indigo over magenta to peach), shaded by its slope, and outlined faintly;
# facets are drawn far to near, so near ones cover far ones. Toward the border of the ground the facets fade out.
#
# scripts/make-animated-icon.py reads the place of the two craters (craters()) and the look of the fumes from here.
import math, os, random, sys

GRID = 38                 # facets along each side of the ground
AZIMUTH, ELEVATION = 40, 38   # the view: turned by 40 degrees, seen from 38 degrees above the ground
Z_SCALE = 1.5             # heights are drawn this much taller than they are
BOX = 800                 # the drawing is fitted into a square of this size (of 1024)
SHIFT_Y = -4
GAMMA = 0.85              # below 1: the upper slopes get the light colors sooner
LINE, LINE_WIDTH, LINE_OPACITY = '#101113', 1.05, 0.42
RAMP = ['#2f2f8f', '#6b45d8', '#c452d8', '#ff6f9c', '#ffcb7a']   # ground ... rim
TILE_TOP, TILE_BOTTOM, TILE_EDGE = '#2b2d31', '#17181a', 'rgba(255,255,255,0.16)'

# The fumes. A puff is born small inside a crater, rises, widens, drifts with a light wind to the right and fades.
PUFFS = 11                # puffs in the air over the large crater at any time (the small one gets fewer)
RISE = (2.9, 3.5)         # how far a puff rises, in crater widths
DRIFT = (0.5, 1.3)        # how far the wind carries it to the right, in crater widths
GROW = (2.9, 3.7)         # how much wider it is at the end than the puff it starts as
OPACITY = 0.8             # of a puff at its most solid
FUME = [('0', '#fff3e6', 0.85), ('0.5', '#e9defa', 0.42), ('1', '#d5c8f5', 0)]     # center ... edge of a puff
GLOW = [('0', '#fff0c8', 0.9), ('0.6', '#ffb46a', 0.4), ('1', '#ff8a5c', 0)]       # the warm light inside a crater

def smooth(lo, hi, v):    # 0 below lo, 1 above hi, an S-shaped rise between
    t = min(1, max(0, (v - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)

def cone(x, y, cx, cy, width, crater, depth, height=1.0):
    """A mountain with a crater: a wide hill minus a narrow dent in its middle."""
    r2 = (x - cx) ** 2 + (y - cy) ** 2
    return height * (math.exp(-r2 / width ** 2) - depth * math.exp(-r2 / crater ** 2))

VOLCANOES = [(-0.27, 0.16, 0.31, 0.155, 0.85, 1.2), (0.38, -0.30, 0.215, 0.10, 0.82, 0.70)]   # center x, y, width, crater, depth, height

def surface(x, y):
    """The large volcano and the smaller one beside it; level ground at the border (x and y run from -1 to 1)."""
    z = sum(cone(x, y, *v) for v in VOLCANOES)
    return z * (1 - smooth(0.74, 0.98, max(abs(x), abs(y))))

def fade(x, y, start=0.80, end=1.0, p=6):
    """How solid the ground is at (x, y): 1 inside, 0 at the border, along a square with rounded corners."""
    return 1 - smooth(start, end, (abs(x) ** p + abs(y) ** p) ** (1 / p))

RGB = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in RAMP]
def color(t, shade):
    t = min(1, max(0, t)) * (len(RGB) - 1)
    i = min(int(t), len(RGB) - 2); u = t - i
    return '#%02x%02x%02x' % tuple(int(min(255, max(0, (RGB[i][k] + (RGB[i + 1][k] - RGB[i][k]) * u) * shade))) for k in range(3))

def project(x, y, z):   # -> across, down, depth
    az, el = math.radians(AZIMUTH), math.radians(ELEVATION)
    xr = x * math.cos(az) - y * math.sin(az)
    yr = x * math.sin(az) + y * math.cos(az)
    return xr, -(yr * math.sin(el) + z * Z_SCALE * math.cos(el)), yr

def layout():
    """The grid, its heights and its projected points, and how the projection sits on the canvas (scale, offsets)."""
    n = GRID
    g = [[(-1 + 2 * i / n, -1 + 2 * j / n) for j in range(n + 1)] for i in range(n + 1)]
    z = [[surface(*g[i][j]) for j in range(n + 1)] for i in range(n + 1)]
    p = [[project(g[i][j][0], g[i][j][1], z[i][j]) for j in range(n + 1)] for i in range(n + 1)]
    xs = [q[0] for r in p for q in r]; ys = [q[1] for r in p for q in r]
    s = min(BOX / (max(xs) - min(xs)), BOX / (max(ys) - min(ys)))
    ox = 512 - s * (max(xs) + min(xs)) / 2; oy = 512 + SHIFT_Y - s * (max(ys) + min(ys)) / 2
    return g, z, p, s, ox, oy

def craters():
    """The rim of each crater as an ellipse on the 1024 canvas: (center x, center y, half width, half height)."""
    _, _, _, s, ox, oy = layout()
    rims = []
    for cx, cy, *_ in VOLCANOES:
        ring = lambda r: sum(surface(cx + r * math.cos(k * math.pi / 8), cy + r * math.sin(k * math.pi / 8)) for k in range(16)) / 16
        r = max((i / 400 for i in range(1, 120)), key=ring)   # the rim is the ring around the center that stands highest
        a, b, _ = project(cx, cy, ring(r))
        rims.append((ox + s * a, oy + s * b, r * s, r * s * math.sin(math.radians(ELEVATION))))
    return rims

def gradient(name, stops):
    return f'<radialGradient id="{name}">' + ''.join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops) + '</radialGradient>'

def along(keys, t):
    """The value at time t on a path given as (time, value) points, straight between them."""
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return keys[-1][1]

def still_fumes():
    """The fumes standing still: over each crater the puffs of the animated icon at one moment, each at another
    point of its life (the path, the growth and the fading are the ones in make-animated-icon.py's keyframes)."""
    rnd = random.Random(5)   # the same plume every time
    rims = craters(); widest = max(r[2] for r in rims)
    mid = lambda pair: (pair[0] + pair[1]) / 2
    b = ''
    for cx, cy, rx, ry in rims:
        size = rx / widest
        n = max(3, round(PUFFS * size))
        b += f'<ellipse cx="{cx:.1f}" cy="{cy + ry * 0.2:.1f}" rx="{rx * 0.78:.1f}" ry="{ry * 0.72:.1f}" fill="url(#glow)" opacity="0.3"/>'
        for i in range(n):
            t = 0.07 + 0.84 * (i + rnd.uniform(-0.25, 0.25)) / (n - 1)          # where in its life this puff is
            dx = rnd.uniform(*DRIFT) * rx; dy = -mid(RISE) * rx; sway = rnd.uniform(-0.25, 0.25) * rx; grow = mid(GROW)
            x = cx + rnd.uniform(-0.2, 0.2) * rx + along([(0, 0), (0.35, 0.18 * dx + sway), (0.70, 0.55 * dx - 0.6 * sway), (1, dx)], t)
            y = cy + ry * 0.15 + along([(0, 0), (0.35, 0.38 * dy), (0.70, 0.74 * dy), (1, dy)], t)
            r = rx * 0.43 * along([(0, 0.35), (0.35, 0.5 * grow), (0.70, 0.8 * grow), (1, grow)], t)
            o = OPACITY * (0.8 + 0.2 * size) * along([(0, 0), (0.12, 1), (0.60, 0.55), (1, 0)], t)
            b += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.1f}" fill="url(#fume)" opacity="{o:.3f}"/>'
    return b

def facets():
    """The facets, far to near: (corner points on the canvas, height 0..1, shade, how solid)."""
    n = GRID
    g, z, p, s, ox, oy = layout()
    quads = []
    for i in range(n):
        for j in range(n):
            c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            pts = [(ox + s * p[a][b][0], oy + s * p[a][b][1]) for a, b in c]
            depth = sum(p[a][b][2] for a, b in c) / 4
            h = sum(z[a][b] for a, b in c) / 4
            # light from the upper left: the slope of a facet along x and y brightens or darkens it
            dzx = (z[i + 1][j] + z[i + 1][j + 1] - z[i][j] - z[i][j + 1]) / 2
            dzy = (z[i][j + 1] + z[i + 1][j + 1] - z[i][j] - z[i + 1][j]) / 2
            shade = max(0.72, min(1.25, 1.0 + 0.55 * (-dzx * 0.6 - dzy * 0.8)))
            solid = fade((g[i][j][0] + g[i + 1][j + 1][0]) / 2, (g[i][j][1] + g[i + 1][j + 1][1]) / 2)
            quads.append((depth, pts, h, shade, solid))
    lo = min(q[2] for q in quads); hi = max(q[2] for q in quads)
    quads.sort(key=lambda q: -q[0])
    return [(pts, (h - lo) / (hi - lo), shade, solid) for _, pts, h, shade, solid in quads]

def drawing(fumes=False):
    b = ('<defs><linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">'
         f'<stop offset="0" stop-color="{TILE_TOP}"/><stop offset="1" stop-color="{TILE_BOTTOM}"/></linearGradient>'
         + (gradient('fume', FUME) + gradient('glow', GLOW) if fumes else '') +
         '<clipPath id="clip"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath></defs>'
         '<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#tile)"/>'
         f'<rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="{TILE_EDGE}" stroke-width="3"/>'
         '<g clip-path="url(#clip)">')
    for pts, h, shade, solid in facets():
        if solid <= 0.004:
            continue
        points = ' '.join(f'{x:.1f},{y:.1f}' for x, y in pts)
        c = color(h ** GAMMA, shade)
        # the facet (its own color also along its edge, so no hairline of the tile shows between facets), then its outline
        b += f'<polygon points="{points}" fill="{c}" stroke="{c}" stroke-width="1.2" stroke-linejoin="round" opacity="{solid:.3f}"/>'
        b += f'<polygon points="{points}" fill="none" stroke="{LINE}" stroke-width="{LINE_WIDTH}" stroke-opacity="{LINE_OPACITY * solid:.3f}" stroke-linejoin="round"/>'
    return b + (still_fumes() if fumes else '') + '</g>'

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    for name, body in (('plotfolio-icon', drawing()), ('plotfolio-icon-fumes', drawing(fumes=True))):
        open(os.path.join(out, name + '.svg'), 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{body}</svg>\n')
        open(os.path.join(out, name + '-full.svg'), 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="100 100 824 824">{body}</svg>\n')
    print('wrote', out)
