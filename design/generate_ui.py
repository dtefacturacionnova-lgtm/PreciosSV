#!/usr/bin/env python3
"""
PreciosSV - UI Prototype Generator
Renders a 1440x900 desktop mockup using Pillow.
"""

from PIL import Image, ImageDraw, ImageFont
import os
import math

# ─────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────
FONTS_DIR = r"C:\Users\DELL\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\4e05c38e-8c9a-43c9-a68b-a32f2bb90d84\5edcdc40-7276-4bef-a8a8-0e7d4bb93994\skills\canvas-design\canvas-fonts"
OUTPUT_PATH = r"C:\Sistemas\PreciosSV\design\prototipo-ui.png"

# ─────────────────────────────────────────────
# Colors
# ─────────────────────────────────────────────
C_BLUE       = (30, 64, 175)      # #1E40AF
C_EMERALD    = (5, 150, 105)      # #059669
C_AMBER      = (245, 158, 11)     # #F59E0B
C_BG         = (241, 245, 249)    # #F1F5F9
C_TEXT       = (15, 23, 42)       # #0F172A
C_TEXT2      = (100, 116, 139)    # #64748B
C_WHITE      = (255, 255, 255)
C_BORDER     = (226, 232, 240)    # #E2E8F0
C_DARK_BG    = (15, 23, 42)       # #0F172A
C_SLATE50    = (248, 250, 252)
C_RED        = (220, 38, 38)      # Súper Selectos
C_BLUE2      = (29, 78, 216)      # Walmart
C_GREEN2     = (22, 163, 74)      # Don Juan
C_ORANGE     = (234, 88, 12)      # Maxi
C_PURPLE     = (124, 58, 237)     # Familiar
C_AMBER_DARK = (180, 110, 5)
C_PRICE_OLD  = (148, 163, 184)    # slate-400
C_SHADOW     = (0, 0, 0, 18)
C_AMBER_BG   = (255, 251, 235)    # amber-50
C_BLUE_LIGHT = (219, 234, 254)    # blue-100
C_EMERD_DARK = (4, 120, 87)       # emerald-700


# ─────────────────────────────────────────────
# Font loader
# ─────────────────────────────────────────────
def load_font(name, size):
    path = os.path.join(FONTS_DIR, name)
    try:
        return ImageFont.truetype(path, size)
    except Exception as e:
        print(f"  [warn] Could not load {name}: {e}")
        return ImageFont.load_default()

# Pre-load fonts
F_LOGO_MAIN   = load_font("Outfit-Bold.ttf", 28)
F_NAV         = load_font("WorkSans-Regular.ttf", 15)
F_NAV_BOLD    = load_font("WorkSans-Bold.ttf", 15)
F_HERO_TITLE  = load_font("Outfit-Bold.ttf", 52)
F_HERO_SUB    = load_font("WorkSans-Regular.ttf", 20)
F_SECTION     = load_font("WorkSans-Bold.ttf", 22)
F_PILL        = load_font("WorkSans-Bold.ttf", 13)
F_CARD_NAME   = load_font("WorkSans-Bold.ttf", 14)
F_CARD_BRAND  = load_font("WorkSans-Regular.ttf", 12)
F_PRICE_OLD   = load_font("WorkSans-Regular.ttf", 13)
F_PRICE_NEW   = load_font("Outfit-Bold.ttf", 22)
F_BADGE       = load_font("WorkSans-Bold.ttf", 12)
F_SUPER_LABEL = load_font("WorkSans-Regular.ttf", 12)
F_B2B_TITLE   = load_font("Outfit-Bold.ttf", 36)
F_B2B_SUB     = load_font("WorkSans-Regular.ttf", 18)
F_BTN         = load_font("WorkSans-Bold.ttf", 15)
F_SEARCH      = load_font("WorkSans-Regular.ttf", 14)
F_SMALL       = load_font("WorkSans-Regular.ttf", 11)
F_TAG_ICON    = load_font("Outfit-Bold.ttf", 20)
F_HERO_BADGE  = load_font("WorkSans-Bold.ttf", 12)
F_OFFERS_COUNT= load_font("WorkSans-Regular.ttf", 14)

# ─────────────────────────────────────────────
# Drawing helpers
# ─────────────────────────────────────────────

def rounded_rect(draw, xy, radius, fill, outline=None, outline_width=1):
    x0, y0, x1, y1 = xy
    r = radius
    # Fill with polygon + ellipses
    draw.rectangle([x0 + r, y0, x1 - r, y1], fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1 - r], fill=fill)
    draw.ellipse([x0, y0, x0 + 2*r, y0 + 2*r], fill=fill)
    draw.ellipse([x1 - 2*r, y0, x1, y0 + 2*r], fill=fill)
    draw.ellipse([x0, y1 - 2*r, x0 + 2*r, y1], fill=fill)
    draw.ellipse([x1 - 2*r, y1 - 2*r, x1, y1], fill=fill)
    if outline:
        draw.arc([x0, y0, x0 + 2*r, y0 + 2*r], 180, 270, fill=outline, width=outline_width)
        draw.arc([x1 - 2*r, y0, x1, y0 + 2*r], 270, 360, fill=outline, width=outline_width)
        draw.arc([x0, y1 - 2*r, x0 + 2*r, y1], 90, 180, fill=outline, width=outline_width)
        draw.arc([x1 - 2*r, y1 - 2*r, x1, y1], 0, 90, fill=outline, width=outline_width)
        draw.line([x0 + r, y0, x1 - r, y0], fill=outline, width=outline_width)
        draw.line([x0 + r, y1, x1 - r, y1], fill=outline, width=outline_width)
        draw.line([x0, y0 + r, x0, y1 - r], fill=outline, width=outline_width)
        draw.line([x1, y0 + r, x1, y1 - r], fill=outline, width=outline_width)


def draw_shadow(img, xy, radius, blur_radius=8, alpha=40):
    """Simple drop shadow using a separate RGBA layer."""
    x0, y0, x1, y1 = xy
    shadow_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow_layer)
    offset = 3
    rounded_rect(sdraw, [x0 + offset, y0 + offset, x1 + offset, y1 + offset],
                 radius, fill=(0, 0, 0, alpha))
    # Simple blur simulation: paste multiple times with decreasing alpha
    from PIL import ImageFilter
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur_radius))
    img.paste(shadow_layer, (0, 0), shadow_layer)


def text_center(draw, text, font, cx, y, fill):
    bbox = font.getbbox(text)
    w = bbox[2] - bbox[0]
    draw.text((cx - w // 2, y), text, font=font, fill=fill)


def text_width(text, font):
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0]


def text_height(text, font):
    bbox = font.getbbox(text)
    return bbox[3] - bbox[1]


# ─────────────────────────────────────────────
# Price tag icon
# ─────────────────────────────────────────────
def draw_price_tag_icon(draw, cx, cy, size=22, color=C_EMERALD):
    """Draw a simple price-tag shape (rounded rect with notch + hole)."""
    hw = size // 2
    # Main tag body (rounded rectangle)
    rounded_rect(draw, [cx - hw, cy - hw + 2, cx + hw - 4, cy + hw - 2], 4, fill=color)
    # Notch on right side
    draw.polygon([
        (cx + hw - 4, cy - 5),
        (cx + hw + 4, cy),
        (cx + hw - 4, cy + 5),
    ], fill=color)
    # Hole (white circle)
    hole_r = 3
    draw.ellipse([cx - hw + 5 - hole_r, cy - hole_r, cx - hw + 5 + hole_r, cy + hole_r],
                 fill=C_WHITE)


# ─────────────────────────────────────────────
# Supermarket dot
# ─────────────────────────────────────────────
SUPER_COLORS = {
    "Súper Selectos": C_RED,
    "Walmart":        C_BLUE2,
    "Don Juan":       C_GREEN2,
    "Maxi Despensa":  C_ORANGE,
    "Familiar":       C_PURPLE,
}


# ─────────────────────────────────────────────
# Product icon placeholder (simple SVG-like drawing)
# ─────────────────────────────────────────────
def draw_product_placeholder(draw, x, y, w, h, product_type):
    """Draw a simple product image placeholder."""
    # Background
    draw.rectangle([x, y, x + w, y + h], fill=C_SLATE50)
    cx = x + w // 2
    cy = y + h // 2

    if product_type == "milk":
        # Milk carton silhouette
        bx, by = cx - 18, cy - 24
        draw.rectangle([bx, by + 8, bx + 36, by + 48], fill=(200, 220, 240))
        draw.polygon([(bx, by + 8), (cx, by), (bx + 36, by + 8)], fill=(180, 200, 225))
        draw.rectangle([bx + 10, by + 18, bx + 26, by + 40], fill=C_WHITE)
        draw.text((bx + 11, by + 22), "leche", font=F_SMALL, fill=C_TEXT2)
    elif product_type == "oil":
        # Oil bottle
        draw.ellipse([cx - 10, cy - 28, cx + 10, cy - 18], fill=(220, 180, 40))
        draw.rectangle([cx - 14, cy - 18, cx + 14, cy + 24], fill=(245, 200, 50))
        draw.rectangle([cx - 10, cy - 6, cx + 10, cy + 10], fill=(200, 160, 20))
        draw.ellipse([cx - 12, cy + 18, cx + 12, cy + 28], fill=(235, 190, 40))
    elif product_type == "rice":
        # Rice bag
        rounded_rect(draw, [cx - 20, cy - 28, cx + 20, cy + 28], 6, fill=(245, 235, 200))
        draw.text((cx - 16, cy - 8), "ARROZ", font=F_SMALL, fill=(140, 100, 40))
        draw.text((cx - 12, cy + 4), "5 lbs", font=F_SMALL, fill=(160, 120, 60))
    elif product_type == "beans":
        # Beans bag
        rounded_rect(draw, [cx - 20, cy - 28, cx + 20, cy + 28], 6, fill=(180, 120, 80))
        draw.text((cx - 18, cy - 8), "FRIJOLES", font=F_SMALL, fill=C_WHITE)
        draw.text((cx - 12, cy + 4), "2 lbs", font=F_SMALL, fill=(230, 200, 180))
    elif product_type == "sugar":
        # Sugar bag
        rounded_rect(draw, [cx - 20, cy - 28, cx + 20, cy + 28], 6, fill=(255, 245, 220))
        draw.text((cx - 14, cy - 8), "AZUCAR", font=F_SMALL, fill=(140, 100, 40))
        draw.text((cx - 12, cy + 4), "1 kg", font=F_SMALL, fill=(160, 120, 60))
    elif product_type == "detergent":
        # Detergent bottle
        rounded_rect(draw, [cx - 16, cy - 26, cx + 16, cy + 26], 8, fill=(30, 100, 200))
        draw.rectangle([cx - 8, cy - 34, cx + 8, cy - 26], fill=(20, 80, 170))
        rounded_rect(draw, [cx - 8, cy - 10, cx + 8, cy + 8], 4, fill=C_WHITE)
        draw.text((cx - 14, cy - 6), "DETERG.", font=F_SMALL, fill=C_WHITE)


# ─────────────────────────────────────────────
# Card drawing
# ─────────────────────────────────────────────
def draw_product_card(img, draw, x, y, w, h, data):
    # Shadow
    draw_shadow(img, [x, y, x + w, y + h], 12, blur_radius=10, alpha=30)

    # Card background
    rounded_rect(draw, [x, y, x + w, y + h], 12, fill=C_WHITE, outline=C_BORDER, outline_width=1)

    # Product image area
    img_h = 130
    img_x, img_y = x + 1, y + 1
    img_w = w - 2
    # Rounded top
    rounded_rect(draw, [img_x, img_y, img_x + img_w, img_y + img_h], 12, fill=C_SLATE50)
    # Clip bottom corners square
    draw.rectangle([img_x, img_y + img_h // 2, img_x + img_w, img_y + img_h], fill=C_SLATE50)

    # Draw product illustration
    draw_product_placeholder(draw, img_x + 1, img_y, img_w - 2, img_h, data["type"])

    # Discount badge (amber circle top-right)
    badge_cx = x + w - 22
    badge_cy = y + 22
    badge_r = 20
    draw.ellipse([badge_cx - badge_r, badge_cy - badge_r,
                  badge_cx + badge_r, badge_cy + badge_r], fill=C_AMBER)
    badge_text = f"-{data['discount']}%"
    bt_w = text_width(badge_text, F_BADGE)
    draw.text((badge_cx - bt_w // 2, badge_cy - 7), badge_text, font=F_BADGE, fill=C_WHITE)

    # Text area
    tx = x + 14
    ty = y + img_h + 12

    # Product name
    draw.text((tx, ty), data["name"], font=F_CARD_NAME, fill=C_TEXT)
    ty += 20

    # Brand
    draw.text((tx, ty), data["brand"], font=F_CARD_BRAND, fill=C_TEXT2)
    ty += 20

    # Original price (struck through)
    orig_text = f"${data['original']:.2f}"
    draw.text((tx, ty), orig_text, font=F_PRICE_OLD, fill=C_PRICE_OLD)
    # Strikethrough line
    ot_w = text_width(orig_text, F_PRICE_OLD)
    line_y = ty + 8
    draw.line([tx, line_y, tx + ot_w, line_y], fill=C_PRICE_OLD, width=1)
    ty += 18

    # Sale price
    price_text = f"${data['sale']:.2f}"
    draw.text((tx, ty), price_text, font=F_PRICE_NEW, fill=C_TEXT)
    ty += 32

    # Supermarket indicator
    super_color = SUPER_COLORS.get(data["super"], C_BLUE)
    dot_r = 5
    dot_x = tx + dot_r
    dot_y = ty + dot_r
    draw.ellipse([dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r],
                 fill=super_color)
    draw.text((dot_x + dot_r + 6, ty - 1), data["super"], font=F_SUPER_LABEL, fill=C_TEXT2)

    # Separator line above supermarket
    draw.line([x + 14, ty - 10, x + w - 14, ty - 10], fill=C_BORDER, width=1)


# ─────────────────────────────────────────────
# Main render
# ─────────────────────────────────────────────
def render():
    W, H = 1440, 900
    img = Image.new("RGBA", (W, H), C_BG + (255,))
    draw = ImageDraw.Draw(img)

    # ── NAVBAR ──────────────────────────────────
    nav_h = 68
    # Navbar background with subtle bottom shadow
    nav_layer = Image.new("RGBA", (W, nav_h + 10), (0, 0, 0, 0))
    nav_draw = ImageDraw.Draw(nav_layer)
    nav_draw.rectangle([0, 0, W, nav_h], fill=C_WHITE + (255,))
    from PIL import ImageFilter
    nav_shadow = nav_layer.filter(ImageFilter.GaussianBlur(3))
    img.paste(nav_shadow, (0, 0), nav_shadow)
    draw.rectangle([0, 0, W, nav_h], fill=C_WHITE)
    draw.line([0, nav_h, W, nav_h], fill=C_BORDER, width=1)

    # Logo: price tag icon + "Precio" + "SV"
    logo_x = 80
    logo_cy = nav_h // 2
    draw_price_tag_icon(draw, logo_x + 12, logo_cy, size=24, color=C_EMERALD)
    logo_text_x = logo_x + 30
    draw.text((logo_text_x, logo_cy - 15), "Precio", font=F_LOGO_MAIN, fill=C_BLUE)
    pw = text_width("Precio", F_LOGO_MAIN)
    draw.text((logo_text_x + pw, logo_cy - 15), "SV", font=F_LOGO_MAIN, fill=C_EMERALD)

    # Search bar (centered)
    sb_w = 480
    sb_x = (W - sb_w) // 2
    sb_y = (nav_h - 40) // 2
    rounded_rect(draw, [sb_x, sb_y, sb_x + sb_w, sb_y + 40], 20,
                 fill=C_BG, outline=C_BORDER, outline_width=2)
    # Search icon (magnifier)
    si_cx = sb_x + 22
    si_cy = sb_y + 20
    draw.ellipse([si_cx - 7, si_cy - 7, si_cx + 7, si_cy + 7], outline=C_TEXT2, width=2)
    draw.line([si_cx + 5, si_cy + 5, si_cx + 10, si_cy + 10], fill=C_TEXT2, width=2)
    draw.text((sb_x + 38, sb_y + 12), "Buscar productos, marcas, supermercados...",
              font=F_SEARCH, fill=C_TEXT2)

    # Nav buttons
    btn_y = (nav_h - 36) // 2
    # "Iniciar sesión" - outline button
    btn1_w = 130
    btn1_x = W - 80 - 160 - btn1_w - 12
    rounded_rect(draw, [btn1_x, btn_y, btn1_x + btn1_w, btn_y + 36], 8,
                 fill=C_WHITE, outline=C_BLUE, outline_width=2)
    t = "Iniciar sesión"
    draw.text((btn1_x + (btn1_w - text_width(t, F_BTN)) // 2, btn_y + 10),
              t, font=F_BTN, fill=C_BLUE)

    # "Soy Proveedor" - filled button
    btn2_w = 148
    btn2_x = W - 80 - btn2_w
    rounded_rect(draw, [btn2_x, btn_y, btn2_x + btn2_w, btn_y + 36], 8,
                 fill=C_EMERALD, outline=None)
    t2 = "Soy Proveedor"
    draw.text((btn2_x + (btn2_w - text_width(t2, F_BTN)) // 2, btn_y + 10),
              t2, font=F_BTN, fill=C_WHITE)

    # ── HERO SECTION ────────────────────────────
    hero_y = nav_h
    hero_h = 170

    # Gradient background (simulate with rectangles)
    for i in range(hero_h):
        t_ratio = i / hero_h
        r = int(241 + (255 - 241) * t_ratio * 0.3)
        g = int(245 + (255 - 245) * t_ratio * 0.3)
        b = int(249 + (255 - 249) * t_ratio * 0.3)
        draw.line([0, hero_y + i, W, hero_y + i], fill=(r, g, b))

    # "Ofertas del día" badge
    badge_y = hero_y + 30
    badge_x = 80
    badge_text = "🔥  Ofertas del día"
    badge_w = 160
    rounded_rect(draw, [badge_x, badge_y, badge_x + badge_w, badge_y + 28], 14,
                 fill=C_AMBER_BG)
    # amber dot
    draw.ellipse([badge_x + 10, badge_y + 9, badge_x + 20, badge_y + 19], fill=C_AMBER)
    draw.text((badge_x + 26, badge_y + 7), "Ofertas del día", font=F_HERO_BADGE, fill=(146, 64, 14))

    # Hero headline
    headline = "Compara precios."
    headline2 = "Ahorra más."
    h_y = badge_y + 38
    draw.text((80, h_y), headline, font=F_HERO_TITLE, fill=C_TEXT)
    hw1 = text_width(headline, F_HERO_TITLE)
    draw.text((80, h_y), headline, font=F_HERO_TITLE, fill=C_TEXT)
    # Second line with accent
    draw.text((80, h_y + 58), headline2, font=F_HERO_TITLE, fill=C_BLUE)

    # Subtitle
    sub_y = h_y + 2
    sub_text = "Compara precios en los 5 supermercados de El Salvador"
    draw.text((80 + hw1 + 30, sub_y + 6), sub_text, font=F_HERO_SUB, fill=C_TEXT2)

    # Stats row
    stats = [
        ("1,240+", "productos"),
        ("5", "supermercados"),
        ("Actualizado", "hoy"),
    ]
    sx = 80 + hw1 + 30
    sy = sub_y + 40
    for val, label in stats:
        draw.text((sx, sy), val, font=F_NAV_BOLD, fill=C_BLUE)
        vw = text_width(val, F_NAV_BOLD)
        draw.text((sx + vw + 4, sy + 1), label, font=F_NAV, fill=C_TEXT2)
        lw = text_width(label, F_NAV)
        sx += vw + lw + 30
        if sx < W - 200:
            draw.text((sx - 18, sy), "·", font=F_NAV, fill=C_TEXT2)

    # ── FILTER PILLS ────────────────────────────
    filters_y = hero_y + hero_h + 20
    filters = ["Todos", "Súper Selectos", "Walmart", "Don Juan", "Maxi Despensa", "Familiar"]
    pill_x = 80
    pill_h = 38

    for i, label in enumerate(filters):
        lw = text_width(label, F_PILL)
        pw = lw + 28
        is_active = (i == 0)
        if is_active:
            rounded_rect(draw, [pill_x, filters_y, pill_x + pw, filters_y + pill_h], 19,
                         fill=C_BLUE)
            draw.text((pill_x + 14, filters_y + 11), label, font=F_PILL, fill=C_WHITE)
        else:
            # Dot + label for supermarket pills
            rounded_rect(draw, [pill_x, filters_y, pill_x + pw, filters_y + pill_h], 19,
                         fill=C_WHITE, outline=C_BORDER, outline_width=1)
            if label in SUPER_COLORS:
                dot_x = pill_x + 12
                dot_y = filters_y + pill_h // 2
                draw.ellipse([dot_x - 4, dot_y - 4, dot_x + 4, dot_y + 4],
                             fill=SUPER_COLORS[label])
                draw.text((dot_x + 8, filters_y + 11), label, font=F_PILL, fill=C_TEXT)
                pw = lw + 36
            else:
                draw.text((pill_x + 14, filters_y + 11), label, font=F_PILL, fill=C_TEXT)
        pill_x += pw + 10

    # Section label
    section_y = filters_y + pill_h + 24
    draw.text((80, section_y), "Mejores ofertas de hoy", font=F_SECTION, fill=C_TEXT)
    count_text = "Mostrando 6 de 1,240 productos"
    draw.text((W - 80 - text_width(count_text, F_OFFERS_COUNT), section_y + 4),
              count_text, font=F_OFFERS_COUNT, fill=C_TEXT2)

    # ── PRODUCT CARDS ────────────────────────────
    products = [
        {"name": "Leche Entera",     "brand": "Salud",      "type": "milk",      "original": 2.75, "sale": 1.99, "discount": 28, "super": "Súper Selectos"},
        {"name": "Aceite Vegetal",   "brand": "La Yaya",    "type": "oil",       "original": 4.50, "sale": 3.25, "discount": 28, "super": "Walmart"},
        {"name": "Arroz Superior",   "brand": "Calsa",      "type": "rice",      "original": 5.99, "sale": 4.49, "discount": 25, "super": "Don Juan"},
        {"name": "Frijoles Rojos",   "brand": "Conacaste",  "type": "beans",     "original": 3.25, "sale": 2.45, "discount": 25, "super": "Maxi Despensa"},
        {"name": "Azúcar Blanca",    "brand": "Central",    "type": "sugar",     "original": 1.99, "sale": 1.49, "discount": 25, "super": "Familiar"},
        {"name": "Detergente",       "brand": "Rinso",      "type": "detergent", "original": 6.50, "sale": 4.75, "discount": 27, "super": "Súper Selectos"},
    ]

    cards_y = section_y + 40
    card_w = 200
    card_h = 290
    gap = 20
    n_cols = 6
    total_w = n_cols * card_w + (n_cols - 1) * gap
    start_x = (W - total_w) // 2

    for i, prod in enumerate(products):
        cx = start_x + i * (card_w + gap)
        draw_product_card(img, draw, cx, cards_y, card_w, card_h, prod)

    # ── B2B SECTION ─────────────────────────────
    b2b_y = cards_y + card_h + 40
    b2b_h = H - b2b_y
    if b2b_h < 80:
        b2b_h = 100
        # Expand canvas height if needed
    draw.rectangle([0, b2b_y, W, H], fill=C_DARK_BG)

    # B2B content
    b2b_cy = b2b_y + (H - b2b_y) // 2
    b2b_title = "¿Eres proveedor o fabricante?"
    b2b_sub   = "Lleva tus productos a miles de compradores. Publica precios, gestiona ofertas y analiza tendencias."
    b2b_cta   = "Comenzar gratis →"

    # Accent line
    acc_w = 48
    acc_h = 4
    acc_x = (W - acc_w) // 2
    rounded_rect(draw, [acc_x, b2b_cy - 52, acc_x + acc_w, b2b_cy - 52 + acc_h], 2,
                 fill=C_EMERALD)

    text_center(draw, b2b_title, F_B2B_TITLE, W // 2, b2b_cy - 40, fill=C_WHITE)
    text_center(draw, b2b_sub, F_B2B_SUB, W // 2, b2b_cy + 10, fill=(148, 163, 184))

    # CTA button
    cta_w = 200
    cta_h = 48
    cta_x = (W - cta_w) // 2
    cta_y = b2b_cy + 50
    draw_shadow(img, [cta_x, cta_y, cta_x + cta_w, cta_y + cta_h], 10, alpha=60)
    rounded_rect(draw, [cta_x, cta_y, cta_x + cta_w, cta_y + cta_h], 10, fill=C_EMERALD)
    t = b2b_cta
    draw.text((cta_x + (cta_w - text_width(t, F_BTN)) // 2, cta_y + 16),
              t, font=F_BTN, fill=C_WHITE)

    # Trust indicators
    trust_items = ["✓  Sin comisiones por venta", "✓  Dashboard en tiempo real", "✓  Soporte local"]
    ti_x_start = W // 2 - 380
    ti_y = cta_y + 62
    for ti in trust_items:
        tw = text_width(ti, F_NAV)
        draw.text((ti_x_start, ti_y), ti, font=F_NAV, fill=(100, 116, 139))
        ti_x_start += tw + 40

    # ── FINAL COMPOSE ───────────────────────────
    final = img.convert("RGB")
    final.save(OUTPUT_PATH, "PNG", quality=95, optimize=False)
    print(f"  Saved: {OUTPUT_PATH}")
    print(f"  Size: {W}x{H}px")


if __name__ == "__main__":
    print("Rendering PreciosSV UI prototype...")
    render()
    print("Done.")
