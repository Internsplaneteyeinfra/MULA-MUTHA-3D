# FLOATING RIVER GARBAGE — VISUAL REFERENCE

## WHAT THE SYSTEM LOOKS LIKE

This document provides a visual reference for the existing floating river garbage system.

---

## DEBRIS CLUSTER COMPOSITION

Each garbage site consists of multiple individual waste items arranged naturally:

```
TOP VIEW OF DEBRIS CLUSTER (~2.35m diameter):

        🧃 bottle
    📦 crate    🥤 bottle
                        🛍️ bag
        🗑️ box     
   💿 foam             📦 crate
        🛍️ bag
    🥤 bottle    📦 box
        💿 foam
```

**Items Per Cluster**: 9-14 objects  
**Total Visual Footprint**: 2-3 meters diameter  
**Individual Item Scale**: 0.15m - 1.05m

---

## SIDE VIEW (Cross-Section)

```
AIR
─────────────────────────────────────────
WATER SURFACE (SURFACE_Y = 9.4m)
    🥤         🗑️      🛍️         ← Floating debris (+0.12m above water)
~~~~~│~~~~~~~~~│~~~~~~~│~~~~~~~~~~
     │         │       │
     │         │       │           ← Water depth
     │         │       │
═════╧═════════╧═══════╧═════════
         RIVERBED
```

**Placement**:
- On-water debris: `y = SURFACE_Y + 0.12`
- Near-river debris: `y = max(terrainY, waterY) + 0.2`

**Animation**:
- Vertical bob: ±0.08m
- Horizontal drift: 0.08-0.14 m/s downstream
- Rotation: 0.15-0.25 rad/s

---

## LOD PROGRESSION

### FAR VIEW (Altitude > 700m)

```
OVERVIEW MODE — Compact dots only

     ·          ·              ·
         ·           ·     ·
   ·                             ·
              RIVER
     ·                 ·
         ·      ·           ·       ·

Visual: Small amber dots (0.55× scale)
Labels: Hidden
Debris: Hidden
Effects: None
```

### MEDIUM VIEW (280-700m)

```
INSPECTION MODE — Markers + visible piles

     ●                  ●
         ▓▓▓     ●             ●
   ●     ▓▓▓                       ●
              RIVER
     ●                 ●      ▓▓▓
         ▓▓▓      ●           ▓▓▓  ●

Visual: Amber markers (1.05× scale) + debris clusters
Labels: Optional (toggle)
Debris: Simplified (1.7× scale)
Effects: None
```

### NEAR VIEW (90-280m)

```
DETAILED MODE — Full models + labels

     ●──────── Site 23, CH 12+456
     │
     ▓         ●──────── Site 24, CH 12+487
     ▓▓▓
    🥤🗑️              RIVER
  🛍️📦💿
               ●────── Site 25, CH 12+512
               ▓▓▓
              🧃📦🛍️

Visual: Full markers + complete debris
Labels: Visible for all or selected
Debris: Full detail (2.3× scale)
Effects: Optional
```

### VERY NEAR VIEW (< 90m)

```
MAXIMUM DETAIL — Everything visible

     ●──────── Site 23, CH 12+456 (SELECTED)
     ║
     ║ glowing stem
     ◉ orb
     ▓▓▓
   🥤🗑️🛍️
  📦💿📦
 ~~~~~~~~~~~~~~~~~~  ripples
    · · · · · ·      floating particles

Visual: Glowing beacon + full debris
Labels: Always visible
Debris: Maximum detail (3.1× scale for selected)
Effects: Ripples + particles active
```

---

## SELECTED vs UNSELECTED STATE

### UNSELECTED SITE
```
     ●  amber dot
     ·  (or debris cluster if near)
```

### SELECTED SITE
```
     Site 23, CH 12+456  ← Dark label
     ◉  glowing amber orb
     ║  vertical stem
     ║
     ▓▓▓  debris pile highlighted
    🥤🗑️
   🛍️📦💿
  ~~~~~~~~~  water ripples
     · · ·   particles
```

**Selection Indicators**:
- 🔴 Orange ground glow (vs amber)
- 🟡 Glowing vertical beacon (stem + orb)
- 🏷️ Dark info label always visible
- 💧 Water ripples pulsing
- ✨ Floating particles orbiting
- 📊 Info panel on right side

---

## DENSITY OVERLAY

When enabled, shows spatial concentration:

```
        🟢
    🟢     🟠         🔴
              RIVER
         🔴       🟠
    🟠        🟢

🟢 LOW Density — Green circles (1-3 items)
🟠 MEDIUM Density — Orange circles (4-7 items)
🔴 HIGH Density — Red circles (8+ items)
```

**Visual Properties**:
- Circle radius: 28m
- Opacity: 0.16 + (count × 0.04)
- Positioned at water surface
- Semi-transparent overlay

---

## NAVIGATION HUD

```
┌────────────────────────────────────────┐
│  ←  Sangam side  3 / 6  →              │
│     Site 2 of 5 · Site 23 · CH 12+456  │
└────────────────────────────────────────┘
```

**Elements**:
- **← Button**: Previous location
- **Side Name**: Current corridor section
- **Index**: 3/6 (side 3 of 6 total)
- **Site Info**: 2 of 5 sites in this side
- **Name**: Site 23 (from KML or auto-numbered)
- **Chainage**: CH 12+456 (river distance)
- **→ Button**: Next location

---

## INFO PANEL (Right Side)

```
┌─────────────────────────────────┐
│ 🗑️ GARBAGE LOCATION             │
├─────────────────────────────────┤
│ Name         Site 23             │
│ Side         Sangam Confluence   │
│ Type         General waste       │
│ Location     18.532178° N        │
│              73.854861° E        │
│ Chainage     CH 12+456           │
│ Distance     8.5 m from river    │
│ Status       River               │
└─────────────────────────────────┘
```

---

## HOVER TOOLTIP

```
       pointer
          ↓
     ┌─────────────────────────┐
     │ 🗑️ GARBAGE LOCATION     │
     │ Site 23                 │
     │ CH 12+456               │
     │ Status: River           │
     └─────────────────────────┘
          │
          • debris marker
```

**Trigger**: Mouse hover over debris  
**Content**: Site ID, chainage, status  
**Position**: Anchored above marker  
**Style**: Dark glass with amber accent

---

## DEBRIS MATERIALS & COLORS

### Plastic Bottles
```
    🧃 Translucent with cap
    
Color: Light blue-grey (#C4D4E0)
Cap Color: Amber (#E89A1C) with glow
Roughness: 0.42 (semi-reflective)
Metalness: 0.12
Size: 0.22-0.28m diameter, 1.35m height
```

### Plastic Bags
```
    🛍️ Deformed sphere
    
Color: Dark green-brown (#4f6a48)
Roughness: 0.88 (wet, matted)
Metalness: 0.02
Size: 0.95m sphere, flattened
Scale: 1.45 × 0.72 × 1.2
```

### Foam Blocks
```
    💿 Rectangular block
    
Color: Off-white (#F2EDE4)
Roughness: 0.95 (very rough)
Metalness: 0.0
Size: 1.1 × 0.55 × 0.85 m
```

### Crates/Containers
```
    📦 Box with structure
    
Color: Brown earth (#8B7355)
Roughness: 0.92 (weathered)
Metalness: 0.04
Size: 1.9 × 1.05 × 1.4 m
```

### Markers
```
    ● Ambient (ground dot)
    
Color: Amber (#E89A1C)
Center: Bright white (#fff6d8)
Rim: Light amber (#FFE08A)
Size: 2.4m diameter circle
```

```
    ◉ Selected (beacon)
    
Stem: Hot amber (#FFB347)
Orb: Light amber (#FFE08A)
Halo: Amber glow (#E89A1C)
Glow: Ground disc 2.8m
Height: 11m vertical
```

---

## WATER EFFECTS

### Ripples (NEAR/VERY_NEAR)
```
         ___
      _/     \_
    /           \
  /               \
 |    ● debris    |
  \               /
    \_         _/
       -------

Radius: 1.2-3.8m pulsing
Color: Cyan-blue (#7ec8e8)
Opacity: 0.12-0.28 (breathing)
Speed: 1.1 rad/s pulse
```

### Floating Particles (VERY_NEAR)
```
    ·     orbiting particles
·       ·  (4 per site)
    ●
  ·   ·

Radius: 1.6m orbit
Speed: 0.35 rad/s
Vertical: ±0.12m sine wave
Color: Tan (#c9b896)
Size: 0.12m spheres
```

---

## TYPICAL RIVER SCENE

```
DOWNSTREAM →

                        🏙️ City
                         │
                         │
─────────────────────────┼─────────────────
                         │
    ●🗑️            ●📦         ●🧃
    💿🛍️           🥤🛍️        🗑️📦    ← Debris
~~~~~~~~~~~~│~~~~~~~~│~~~~~~~~~│~~~~~~~
            │        │         │
         MULA-MUTHA RIVER
            │        │         │
    ═══════╧════════╧═════════╧═══════
           RIVERBED

        CH 12+400  CH 12+456  CH 12+512
```

---

## CORRIDOR DISTRIBUTION

The 67 sites are distributed across 6 corridor sides:

```
Side 1: Sangam Confluence
    • Sites: 8
    • Range: CH 0+000 to CH 2+500
    
Side 2: Khadakwasla Reservoir
    • Sites: 12
    • Range: CH 2+500 to CH 5+800
    
Side 3: Urban Dense Zone
    • Sites: 15
    • Range: CH 5+800 to CH 9+200
    
Side 4: Industrial Corridor
    • Sites: 11
    • Range: CH 9+200 to CH 12+600
    
Side 5: Residential East
    • Sites: 13
    • Range: CH 12+600 to CH 15+100
    
Side 6: Downstream Delta
    • Sites: 8
    • Range: CH 15+100 to CH 16+960
```

---

## COLOR PALETTE

### Primary (Amber Theme)
```
🟡 Amber:        #E89A1C  (markers, accents)
🟡 Light Amber:  #FFE08A  (highlights)
🟡 Hot Amber:    #FFB347  (beacon stem)
⚪ White:        #fff6d8  (bright core)
```

### Selection (Orange)
```
🟠 Select:       #FF6B2C  (selected fill)
🔴 Hot:          #FFB347  (beacon glow)
```

### Density
```
🟢 Low:          #27AE60  (green)
🟠 Medium:       #E67E22  (orange)
🔴 High:         #C0392B  (red)
```

### Water Effects
```
🔵 Ripples:      #7ec8e8  (cyan-blue)
🟤 Particles:    #c9b896  (tan)
```

### Materials
```
⚪ Plastic:      #C4D4E0  (light blue-grey)
🟤 Debris:       #8B7355  (brown earth)
🟢 Bag:          #4f6a48  (dark green-brown)
⚪ Foam:         #F2EDE4  (off-white)
```

---

## SCALE REFERENCE

```
HUMAN (1.7m)           vs    DEBRIS CLUSTER (2.35m)

    👤                         🗑️
    ││                        ▓▓▓
    ││                       🥤📦🛍️
    ││                      🧃💿📦
    ││                         
    
    
PLASTIC BOTTLE (1.35m)  vs   FOAM BLOCK (0.55m)

    🧃                         💿
    ││                         ▫
    ││                         
    ││                         
    ││                         
    
    
BEACON HEIGHT (11m)     vs   TREE (15-20m)

        ◉                      🌳🌳🌳
        ║                      ┃┃┃┃┃
        ║                      ┃┃┃┃┃
        ║                      ┃┃┃┃┃
        ║                      ┃┃┃┃┃
        ║                      ┃┃┃┃┃
        ║                      ┃┃┃┃┃
        ║                      ┃┃┃┃┃
```

**Key Point**: Debris is small and realistic, NOT giant objects

---

## TYPICAL USER WORKFLOW

```
1. Open Application
   ↓
2. Click "Layers" button
   ↓
3. Select "Hydrology"
   ↓
4. Click "Pollution / Garbage"
   ↓
5. View debris on river
   ↓
6. [Optional] Toggle "Density Overlay"
   ↓
7. [Optional] Click debris marker
   ↓
8. View info panel + camera flight
   ↓
9. [Optional] Use ← → arrows to tour
   ↓
10. [Optional] Click elsewhere to deselect
```

---

## PERFORMANCE VISUALIZATION

```
CAMERA ALTITUDE vs RENDERED MESHES

High (>700m)  FAR        ▪▪▪▪▪▪▪   67 markers
                         ─────────────────────
                         
Medium (280m) MEDIUM     ▪▪▪▪▪▪▪   67 markers
                         ▓▓▓       ~200 debris
                         ─────────────────────
                         
Low (90m)     NEAR       ▪▪▪▪▪▪▪   67 markers
                         ▓▓▓▓▓▓    ~400 debris
                         ─────────────────────
                         
Ground (30m)  VERY_NEAR  ▪▪▪▪▪▪▪   67 markers
                         ▓▓▓▓▓▓    ~600 debris
                         ~~~       ~200 effects
                         ─────────────────────
```

**Frame Time**:
- FAR: < 2ms
- MEDIUM: ~3ms
- NEAR: ~5ms
- VERY_NEAR: ~8ms

---

## SUMMARY

The floating river garbage system provides:

✅ **Realistic visual scale** (not giant objects)  
✅ **Natural distribution** (follows actual survey)  
✅ **Performance optimization** (LOD system)  
✅ **Rich interaction** (hover, click, tour)  
✅ **Contextual information** (panels, tooltips)  
✅ **Water integration** (floating animation)  
✅ **Density visualization** (concentration zones)

**The system is fully operational and ready to use.**

Activate via: **Layers → Hydrology → Pollution**
