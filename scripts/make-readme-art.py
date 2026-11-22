# Draws the pictures of the README's landing part: the download buttons and one install strip per system.
#   python3 scripts/make-readme-art.py docs/readme
# The app icon in the Mac strip is read from src-tauri/icons (see scripts/make-icon.py for how the icon is made).
# Light and dark are in each file (prefers-color-scheme), so one <img> serves both GitHub themes.
# The other pictures in docs/readme: app.png is a screenshot of the browser build with the "groups" sample at
# 1040 x 562 (the proportions of ecg.gif, so the two stand side by side); the figures are exports from PlotFolio
# with a white card behind them, because exported SVGs have no background and GitHub's dark theme is dark.
import base64, sys, os
out = sys.argv[1]
ICON = base64.b64encode(open(os.path.join(os.path.dirname(__file__), '..', 'src-tauri', 'icons', 'Square142x142Logo.png'), 'rb').read()).decode()
FONT = '-apple-system, BlinkMacSystemFont, \'Segoe UI\', Helvetica, Arial, sans-serif'
STYLE = '''<style>
  text { font-family: %s; }
  .card { fill: #f6f6f7; stroke: #d6d6da; }
  .box { fill: #ffffff; stroke: #d6d6da; }
  .t { fill: #1b1b1d; }
  .t2 { fill: #636368; }
  .ink { stroke: #6d6d73; fill: none; }
  .inkfill { fill: #6d6d73; }
  .soft { fill: #ececee; stroke: #c9c9ce; }
  .acc { fill: #2b6fd6; }
  .ring { fill: none; stroke: #2b6fd6; }
  .onacc { fill: #ffffff; }
  .curve { stroke: #ffffff; }
  @media (prefers-color-scheme: dark) {
    .card { fill: #26272a; stroke: #3b3c41; }
    .box { fill: #1e1f21; stroke: #3b3c41; }
    .t { fill: #e9e9eb; }
    .t2 { fill: #a2a3aa; }
    .ink { stroke: #a2a3aa; }
    .inkfill { fill: #a2a3aa; }
    .soft { fill: #323337; stroke: #4a4b51; }
    .acc { fill: #5b9df5; }
    .ring { stroke: #5b9df5; }
    .onacc { fill: #101113; }
    .curve { stroke: #101113; }
  }
</style>''' % FONT

def svg(w, h, body, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-label="{title}">\n<title>{title}</title>\n{STYLE}\n{body}\n</svg>\n'

# ---------------------------------------------------------------- buttons
def button(name, label, w, primary, icon_kind):
    h = 48
    if icon_kind == 'down':   # arrow into a tray
        ic = '<path d="M0 -8 V5 M-5 0 L0 5 L5 0 M-8 9 H8" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
    else:                     # arrow leaving a box: opens in the browser
        ic = '<path d="M-2 -7 H-7 V7 H7 V2 M1 -7 H7 V-1 M7 -7 L-1 1" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
    if primary:
        body = f'<rect class="acc" x="1" y="1" width="{w-2}" height="{h-2}" rx="8"/>'
        body += f'<g transform="translate(30 24)" style="stroke:currentColor" class="pi">{ic}</g>'
        body += f'<text class="onacc" x="{(w+26)/2}" y="30" font-size="17" font-weight="600" text-anchor="middle">{label}</text>'
        extra = '<style>.pi { color: #ffffff; } @media (prefers-color-scheme: dark) { .pi { color: #101113; } }</style>'
    else:
        body = f'<rect class="box" x="1" y="1" width="{w-2}" height="{h-2}" rx="8" stroke-width="1.5"/>'
        body += f'<g transform="translate(30 24)" style="stroke:currentColor" class="pi">{ic}</g>'
        body += f'<text class="t" x="{(w+26)/2}" y="30" font-size="17" font-weight="600" text-anchor="middle">{label}</text>'
        extra = '<style>.pi { color: #1b1b1d; } @media (prefers-color-scheme: dark) { .pi { color: #e9e9eb; } }</style>'
    open(os.path.join(out, name), 'w').write(svg(w, h, extra + body, label))

button('button-mac.svg', 'Download for Mac', 236, True, 'down')
button('button-windows.svg', 'Download for Windows', 272, True, 'down')
button('button-browser.svg', 'Try it in your browser', 262, False, 'open')

# ---------------------------------------------------------------- install strips
W, H = 960, 302
PW, GAP, X0, BY, BH = 288, 24, 24, 58, 140   # panel width, gap, first x, drawing box top and height

def file_icon(cx, cy, kind):
    # a sheet of paper with a folded corner, 52 x 66
    x, y = cx - 26, cy - 33
    g = f'<path class="box" stroke-width="1.5" d="M{x} {y+5} a5 5 0 0 1 5 -5 h29 l18 18 v43 a5 5 0 0 1 -5 5 h-42 a5 5 0 0 1 -5 -5 z"/>'
    g += f'<path class="ink" stroke-width="1.5" d="M{x+34} {y} v13 a5 5 0 0 0 5 5 h13"/>'
    if kind == 'dmg':   # a disk drive
        g += f'<rect class="ink" stroke-width="1.5" x="{cx-15}" y="{cy+1}" width="30" height="20" rx="4"/><circle class="inkfill" cx="{cx+8}" cy="{cy+11}" r="2.2"/><path class="ink" stroke-width="1.5" d="M{cx-9} {cy+11} h9"/>'
    else:               # a program window
        g += f'<rect class="ink" stroke-width="1.5" x="{cx-15}" y="{cy}" width="30" height="22" rx="3"/><path class="ink" stroke-width="1.5" d="M{cx-15} {cy+7} h30"/>'
    return g

def ring(x, y, w, h, cls='ring', color=None):
    st = f' style="stroke:{color}"' if color else ''
    return f'<rect class="{cls}"{st} x="{x-5}" y="{y-5}" width="{w+10}" height="{h+10}" rx="9" stroke-width="2.5"/>'

def step(i, x, title, lines, drawing):
    g = f'<rect class="box" x="{x}" y="{BY}" width="{PW}" height="{BH}" rx="7"/>' + drawing
    g += f'<circle class="acc" cx="{x+13}" cy="{BY+BH+26}" r="13"/><text class="onacc" x="{x+13}" y="{BY+BH+31}" font-size="15" font-weight="700" text-anchor="middle">{i}</text>'
    g += f'<text class="t" x="{x+36}" y="{BY+BH+32}" font-size="19" font-weight="600">{title}</text>'
    for k, ln in enumerate(lines):
        g += f'<text class="t2" x="{x}" y="{BY+BH+58+k*20}" font-size="15">{ln}</text>'
    return g

def strip(name, system, requirement, steps, label):
    body = f'<rect class="card" x="0.5" y="0.5" width="{W-1}" height="{H-1}" rx="10"/>'
    body += f'<text class="t" x="{X0}" y="38" font-size="21" font-weight="700">{system}</text>'
    body += f'<text class="t2" x="{W-X0}" y="38" font-size="15" text-anchor="end">{requirement}</text>'
    for i, (title, lines, drawing) in enumerate(steps):
        x = X0 + i * (PW + GAP)
        body += step(i + 1, x, title, lines, drawing(x))
        if i < 2:   # a small arrow between the pictures
            ax = x + PW + GAP / 2
            body += f'<path class="ink" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M{ax-4} {BY+BH/2-7} l7 7 l-7 7"/>'
    open(os.path.join(out, name), 'w').write(svg(W, H, body, label))

CY = BY + BH / 2

def mac1(x):
    cx = x + PW / 2
    return file_icon(cx, CY - 12, 'dmg') + f'<text class="t" x="{cx}" y="{CY+44}" font-size="15" text-anchor="middle">PlotFolio.dmg</text>'

def mac2(x):
    ax, fx = x + 78, x + PW - 78
    g = f'<image x="{ax-31}" y="{CY-43}" width="62" height="62" xlink:href="data:image/png;base64,{ICON}" href="data:image/png;base64,{ICON}"/>'
    g += f'<text class="t" x="{ax}" y="{CY+40}" font-size="14" text-anchor="middle">PlotFolio</text>'
    # folder
    g += f'<path class="soft" stroke-width="1.5" d="M{fx-29} {CY-32} a4 4 0 0 1 4 -4 h15 l7 7 h28 a4 4 0 0 1 4 4 v33 a4 4 0 0 1 -4 4 h-50 a4 4 0 0 1 -4 -4 z"/>'
    g += f'<text class="t" x="{fx}" y="{CY+40}" font-size="14" text-anchor="middle">Applications</text>'
    # the drag
    g += f'<path class="ring" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 7" d="M{ax+42} {CY-12} H{fx-52}"/><path class="ring" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M{fx-50} {CY-19} l8 7 l-8 7"/>'
    return g

def mac3(x):
    dx, dy, dw, dh = x + 20, BY + 16, PW - 40, BH - 32
    g = f'<rect class="soft" x="{dx}" y="{dy}" width="{dw}" height="{dh}" rx="8"/>'
    g += f'<text class="t" x="{dx+14}" y="{dy+25}" font-size="14" font-weight="600">Privacy &amp; Security</text>'
    g += f'<text class="t2" x="{dx+14}" y="{dy+45}" font-size="12.5">“PlotFolio” was blocked.</text>'
    bx, by, bw, bh = dx + dw - 124, dy + dh - 38, 110, 26
    g += f'<rect class="box" x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="6"/><text class="t" x="{bx+bw/2}" y="{by+18}" font-size="13.5" text-anchor="middle">Open Anyway</text>'
    return g + ring(bx, by, bw, bh)

BLUE = '#0b62b8'
def win1(x):
    cx = x + PW / 2
    return file_icon(cx, CY - 12, 'exe') + f'<text class="t" x="{cx}" y="{CY+44}" font-size="15" text-anchor="middle">PlotFolio-Setup.exe</text>'

def smartscreen(x):
    dx, dy, dw, dh = x + 16, BY + 12, PW - 32, BH - 24
    g = f'<rect x="{dx}" y="{dy}" width="{dw}" height="{dh}" rx="3" fill="{BLUE}"/>'
    g += f'<text x="{dx+14}" y="{dy+27}" font-size="16" font-weight="600" fill="#ffffff">Windows protected your PC</text>'
    return g, dx, dy, dw, dh

def win2(x):
    g, dx, dy, dw, dh = smartscreen(x)
    g += f'<text x="{dx+14}" y="{dy+48}" font-size="11.5" fill="#dbe9f7">Microsoft Defender SmartScreen prevented</text>'
    g += f'<text x="{dx+14}" y="{dy+63}" font-size="11.5" fill="#dbe9f7">an unrecognized app from starting.</text>'
    g += f'<text x="{dx+14}" y="{dy+dh-17}" font-size="13" fill="#ffffff" text-decoration="underline">More info</text>'
    bw, bh = 88, 24
    bx, bY = dx + dw - 12 - bw, dy + dh - 12 - bh
    g += f'<rect x="{bx}" y="{bY}" width="{bw}" height="{bh}" fill="none" stroke="#ffffff" stroke-width="1.2"/><text x="{bx+bw/2}" y="{bY+16.5}" font-size="12.5" fill="#ffffff" text-anchor="middle">Don’t run</text>'
    return g + ring(dx + 12, dy + dh - 31, 62, 18, color='#ffffff')

def win3(x):
    g, dx, dy, dw, dh = smartscreen(x)
    g += f'<text x="{dx+14}" y="{dy+48}" font-size="11.5" fill="#dbe9f7">App: PlotFolio-Setup.exe</text>'
    g += f'<text x="{dx+14}" y="{dy+63}" font-size="11.5" fill="#dbe9f7">Publisher: Unknown publisher</text>'
    bw, bh = 88, 24
    b2x, bY = dx + dw - 12 - bw, dy + dh - 12 - bh
    b1x = b2x - 10 - bw
    for bx, lab in ((b1x, 'Run anyway'), (b2x, 'Don’t run')):
        g += f'<rect x="{bx}" y="{bY}" width="{bw}" height="{bh}" fill="none" stroke="#ffffff" stroke-width="1.2"/><text x="{bx+bw/2}" y="{bY+16.5}" font-size="12.5" fill="#ffffff" text-anchor="middle">{lab}</text>'
    return g + ring(b1x, bY, bw, bh, color='#ffffff')

strip('install-mac.svg', 'Install on a Mac', 'macOS 12 or later · Apple Silicon and Intel', [
    ('Open the download', ['Double-click PlotFolio.dmg in Downloads.'], mac1),
    ('Drag it to Applications', ['Then open PlotFolio from Applications.'], mac2),
    ('Confirm once', ['macOS blocks the first start. Allow it in', 'System Settings ▸ Privacy &amp; Security.'], mac3),
], 'Install on a Mac: 1. Open PlotFolio.dmg. 2. Drag PlotFolio to Applications. 3. The first time, confirm with Open Anyway in System Settings, Privacy and Security.')

strip('install-windows.svg', 'Install on Windows', 'Windows 10 or 11 · 64-bit', [
    ('Run the download', ['Double-click PlotFolio-Setup.exe.', 'No administrator password is needed.'], win1),
    ('Click “More info”', ['A blue box says that Windows', 'protected your PC.'], win2),
    ('Click “Run anyway”', ['The installer finishes and PlotFolio', 'is in the Start menu.'], win3),
], 'Install on Windows: 1. Run PlotFolio-Setup.exe. 2. In the blue box, click More info. 3. Click Run anyway.')
print('ok')
