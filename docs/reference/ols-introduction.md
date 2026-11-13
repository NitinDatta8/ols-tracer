# OLS Introduction deck: what it says

What the OLS Introduction deck (`docs/internal/OLS Introduction 20260419.pdf`, git-ignored: SW internal training, April
2026, 128 pages) says that the tracer can use. Page numbers are the PDF's (a viewer's): page 25 is a review comment,
so from page 26 on the slide numbers printed on them are one lower.

The cards' and the chassis's front pictures are in `public/faceplates/`, and where each port is on them in
`catalog/common/faceplates.json` (kept by hand; the IIVI syncs never write it). The physical view and the canvas draw a
card the deck has from its picture, with only the ports on its front. The deck's facts for each card are in its
datasheet (click the card's name plate).

## Releases (page 4)

| Platform | Line | 2021 | 2022 | 2023 | 2024 | 1H 2025 | 2H 2025 | 1H 2026 | 2H 2026 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GS2000 | Polaris C+L |  |  |  |  |  | R3.4.0B | R3.4.1B | R3.6.0B |
| GS2000 | Polaris C |  |  |  |  |  | R3.5.0B | R3.5.1B | R3.7.0B |
| GS2000 | Tencent L |  |  | R2.6.0T |  |  |  |  |  |
| GS2000 | Tencent C+L |  |  |  |  | R3.0.0T | R3.1.0T | R3.2.0T |  |
| GS2000 | Tencent POLS |  |  |  |  |  |  | R3.100.0T |  |
| GS2000 | Generic |  |  |  | R2.5.0 |  | R2.9.0 |  | R3.0.0 (1H 2027) |
| GS2000 | CTC Metro |  | R2.0.0 | R2.3.0 | R2.3.2 |  | R2.3.3 |  |  |
| GS2000 | Windstream |  | R1.1.0 | R2.0.0 |  |  |  |  |  |
| OLS1000 | TPC4 | R2.1.0 | R2.1.1 | R2.1.5 |  |  | R2.1.8 | R2.1.10 |  |
| OLS1000 | OPC4 long haul |  | R2.1.0 | R2.1.3 | R2.1.6 | R2.1.8 | R2.1.9 | R2.1.10 | R2.1.11 |
| OLS1000 | FMD | R2.0.0 |  | R2.1.1 | R2.1.2 |  |  | R2.2.0 |  |
| KAPELLA | Tencent KAPELLA |  |  |  |  |  |  | R3.100.0 |  |

Streams in the catalog: Generic is `csp`, Polaris is `polaris` and `csm`, Tencent is `tencent`, CTC is `ctc`,
Windstream is `ws`, KAPELLA is `kpl`.

## GS2000 chassis (page 6)

- Front: slots 1–4 over 5–8, each 1U; a 2- or 4-slot card spans slots side by side in its row. Slot 40 is the front
  panel at the left: LCD, two buttons, LED, latch, handle, and the USB, CON (console) and ETH ports.
- Back: fans in slots 31, 32, 33; PSUs in 21 (top) and 22 (2000 W, AC inlet, latch, handle, LED); the controllers (CU)
  41 and 42, their PULL-OUT tabs (STAT and ACT/STBY LEDs) at the foot of fan bays 31 and 32; at the left the RJ-45s
  MUX1/MUX3, MUX/MUX2 (one-wire management of the mux panels), NMS2, NMS1 and NMS.
- BONE 2.0 (page 93): fans 2+1, PSU 1+1. Polaris C band kit (page 87): 21-inch rack, 2-post and 4-post.
- The catalog's `mgmtPorts.front` says `USB-C, CON, MON` (set in `scripts/sync-streams-chassis-from-iivi.mjs`); the
  deck labels the third front port ETH. Its back `NMS, NMS1, NMS2` leaves out MUX1/MUX3 and MUX/MUX2.

## Generic R2.9 platform (pages 7–8)

- NBI: CLI, NETCONF 1.1, SNMPv2 (traps for alarms only); OpenConfig-based model with extensions.
- Configuration saving: auto or manual. Database backup, restore, clear, return to factory default (reset button or
  NBI), scheduled backups.
- Security: local AA, user levels, lockout and inactivity timers, login banners, management ACL, RADIUS (2 servers),
  TACACS+ (2.9.100), ZTP (2.9.100).
- Equipment: auto and manual provisioning, delete a service module, sub-component versions, 3rd-party transceivers,
  admin state, oper status. Maintenance: software LED lamp test, cold/warm reboot of chassis or module.
- CU 1+1 (switch on hardware failure or by management), local time, time zone, NTP, three-stage upgrade with rollback
  (also for CU 1+1), file upload/download (local or SFTP).
- Network: NMS, ETH (local), OSC and loopback interfaces, static routes and OSPFv2 by CLI, routing table.
- PM: real time, 15 min and 24 h; TCA thresholds. Alarms with threshold profiles (updated in R2.9). Event log, syslog,
  dial-out telemetry, LLDP (CIM and Ethernet service interfaces), SNMP traps.
- L1: fixed and flex mapping, logical-channel type, cross-connections, OpenZR line mode (800G and 400G rate classes),
  coherent/DSP status, CD compensation min/max, roll-off, 100GBE/400GBE clients, 100G IEEE ZR, LLDP on clients, admin
  state, BERT test signal on line and client, facility and terminal loopback, client ALS.
- L0: OSC in-band management, amplifiers, supervisory channel, laser safety, media channels, channel monitor, OTDR,
  auto power control (span measurement, span loss adaptation, channel power control).

## Cards

"Inside" lists the ports the catalog (the product profile) has that the deck's front does not show: the physical view
does not draw them and they take no fiber.

| Deck name | Catalog id (streams) | Slots | Front (optical) | Inside | Pages |
| --- | --- | --- | --- | --- | --- |
| TMUX-C9-25 | lc-c925 (csp) | 2 | LINE, A/D1–A/D9, MON 1/2 (MON1 and MON2 are Tx only) | OSC, BAIN, LINEIN, LINEOUT, PAOUT, COM | 9 |
| TMUX-C9-35 | lc-tmuxc935 (csp) | 2 | as TMUX-C9-25 | as TMUX-C9-25 | 11 |
| TMUX-C-25 | lc-c25 (csp) | 2 | LINE, SIG, MON 1/2 | – | 10 |
| 400MX-S / M4QD | lc-400mx, lc-m4qd (csp, ws) | 1 | L1 QSFP-DD, C1–C4 QSFP28 | – | 12 |
| 800MX | lc-800mx (csp) | 1 | PORT1–5 over PORT6–10, QSFP-DD800 | – | 13–14 |
| 800MX_MACSEC | lc-800mx-sec (csp) | 1 | as 800MX | – | 15–16 |
| L3X8C7 | lc-l3x8c7 (polaris, csm) | 1 | as 800MX | – | 50–52, 79 |
| T1X12C8 (T1XC128) | lc-t1x12c8, lc-t1x12c8l (csp, tencent) | 1 | L1 (T over R), C1 C3 C5 C7 over C2 C4 C6 C8 | – | 18–19, 53 |
| L1X12C8, L1X12C8-L | lc-l1x12c8, lc-l1x12c8l (polaris, csm) | 1 | as T1X12C8 | – | 53–55, 79 |
| T1X8C8 | lc-t1x8c8, lc-t1x8c8l (tencent) | 1 | L1 (T over R), cages 1 3 5 7 over 2 4 6 8 | – | 36–37 |
| LCH08 | lc-lch08 (tencent) | 1 | PORT1–4 over PORT5–8 | – | 39 |
| OP3 | lc-op3 (tencent) | 1 | 1A 1B 1SIG, 2A 2B 2SIG, 3A 3B 3SIG | – | 20 |
| AWCL | lc-awcl (tencent) | 4 | LINE, EXP1–8, AUX, EMUX1–3 (MPO-24), MF (MPO-12) | EXT1, EXT2 (RJ-45s on the front, not fibers) | 21 |
| ILAE-SWG-CL, ILA-SWG-CL | lc-ilae-swg-cl, lc-ila-swg-cl (tencent) | 2 | LINEA, LINEB, AUX | – | 22 |
| FGA | lc-fga (tencent) | 1 | LINE, SIG | – | 33 |
| DGE-CL | lc-dgecl (polaris, csm) | 4 | LINE_WEST, LINE_EAST | – | 45 |
| OLP3-3 | lc-olp3-3 (polaris, csm) | 1 | 1A 1B 1C 1SIG, 2A 2B 2C 2SIG, 3A 3B 3C 3SIG | – | 47, 97 |
| IRA-CL | lc-iracl (polaris, csm) | 4 | LINE, EXP1–8, MPO1–3 | EXP33, SIG | 48, 63 |
| ILA-CL | lc-ilacl (polaris, csm) | 2 | LINE_WEST, LINE_EAST | – | 49 |
| RAMAN-CL-16 | lc-ramancl-16 (polaris, csm) | 1 | LINE, SIG | – | 60–62 |
| TMUX-C64 | lc-tmuxc64 (polaris, csm) | 4 | A, B, MPO1–8 | SIG | 72 |
| TMUX-C-32 | lc-tmuxc-32 (polaris, csm) | 2 | SIG, LINE, AUX | – | 74 |
| ILAD-C-32 | lc-iladc-32 (polaris, csm) | 2 | LINE_WEST, LINE_EAST, AUX | – | 75 |
| ILAD-C-DGE-32 | lc-iladc-dge-32 (polaris, csm) | 4 | LINE_WEST, LINE_EAST, AUX | – | 76 |
| TMUX-C32-32 | lc-tmuxc32-32 (polaris, csm) | 4 | LINE, EXP1–8, MPO1–3 | EXP33, SIG | 77 |
| OLP3 | lc-olp3 (polaris, csm) | 1 | 1A 1B 1SIG, 2A 2B 2SIG, 3A 3B 3SIG | – | 78 |
| FMUX_32 | lc-fmux-32 (polaris, csm) | 2 | SIGA, SIGB, COM1, COM2, SIG, MPO1–4 | EXP33 (WSS COM3 loopback) | 95 |
| IRA_32 | lc-ira-32 (polaris, csm) | 4 | LINE, EXP1–8, MPO1–3 | EXP33, SIG | 96 |
| TILA | lc-tila (polaris, csm) | 2 | LINE_WEST, LINE_EAST | – | 98 |
| DGE | lc-dge (polaris, csm) | 4 | LINE_WEST, LINE_EAST | – | 99 |

Connectors on a front that the catalog has no port for, drawn but not wired: AUX on IRA-CL, TMUX-C32-32, DGE-CL and
ILA-CL; MF on IRA-CL; the OSC SFP cages (OSC, OSCE/OSCW, OSCA/OSCB) on TMUX-C-32, ILAD-C-32, ILA-CL and the ILA-SWG
cards; EXT1/EXT2 RJ-45s and the 12 V extension connector on the 4-slot cards.

Not in the deck, so drawn as before with all their ports: C1125 (box 3's mux), 800TR, M2CQ, M2CP, M10Q2B2, T4B4, T2B2,
M4CP, OA25, OA35, OLA25, OLA35A/B, PTM-E/W, TFF1619–TFF5659, OP1, OP2, TWS05/09OA25/35, OCM, OTDR, CH4L2E8, AOM, OPS,
OP6, OA-SWG, ILA-SWG, ILA-SWG-L, ILAE-SWG-L, CMUX-64, CMUX-32-CL, WSS9, AWL, L1X8C8X8(L), T32X8. The CTC pages
(121–122) and pages 123–125 draw some of these, but too small or with port names that do not match the catalog's
(OA15/22, OLA15/22, OP with SIG/A/B, OTDR O1–O8, OCM P1–P8, M4CP and MCP2D labels), so they are left out.

### Amplifier and ROADM cards

- TMUX-C9-25 (generic R2.9): twin 9-degree WSS; BA and PA 15–25 dB, 21 dBm out; 0–25 dB VOA before the PA (max
  25 dB span attenuation); up to 15 dB per channel; OCM on a 6.25 GHz grid, 12.5 GHz bandwidth steps; 1611 nm OTDR;
  GE OSC at 1510 nm, 28 dB DR; auto span loss measurement and ingress adaptation, auto channel power control. Logical
  port COM between the WSS and the amplifiers. MON1 = LINE OUT test point, MON2 = LINE IN test point after the PA,
  both −19 dB.
- TMUX-C9-35 (R2.9.100): PA 22–35 dB; OTDR 35 dB; OSC 100M DWDM at 191.2 THz (1567.95 nm), 45 dB DR, amplified by the
  PA (3 dB more loss before the OSC Rx in the official release). LEDs: STAT and one per LINE and A/D port.
- TMUX-C-25 (R2.9.100): no WSS; BA 7–18 dB, PA 15–25 dB, both 21 dBm; 0–25 dB VOA before the PA; OCM; GE OSC 1510 nm
  28 dB DR; LEDs STAT, LINE, SIG. Auto span loss measurement and adaptation TBD.
- AWCL (Tencent C+L ROADM, page 21): PA-SWG-C/L 24 dBm (10–20, 20–24 ext; 18–28, 28–32 ext); BA-VGA-C 24 dBm and
  BA-VGA-L 23 dBm with output VOA, 14–22 dB (22–25 ext); HR-OCM C and L; ASE-C and ASE-L; 2×2×32 C&L WSS with a 33rd
  port for ASE add; OTDR 1630–1650 nm 38 dB DR on 2 fibers; OSC 1625 nm 35 dB DR; intra-node SFP 1GbE 191.2 THz; can
  use an external fast ASE filling module; open interface for an external Coherent OSA or probe; manages an extension
  shelf (power and LEDs). LEDs: card, AUX, MF, line and 8 pass-through ports.
- ILAE-SWG-CL and ILA-SWG-CL (page 22): 2×ILA-SWG-C 24 dBm, 2×ILA-SWG-L 23 dBm, output VOA 0–15 dB; HR-OCM per band;
  OTDR 40 dB DR on 4 fibers; 2 OSCs 1625 nm 35 dB; the ILA one has an internal 2 dB GFF middle stage (its MPO-12 for
  middle-stage access is struck out).
- IRA-CL = AWCL board renamed and recoloured; ILA-CL = ILA-SWG-CL board, MF removed; DGE-CL = AWCL board with twin C and
  twin L DGE. Their optics are the same as the boards'.
- BONE 1.0 C band (pages 68–77): TMUX-C64 (two 2×32 WSS, 1×2 switch + 50/50 coupler from A/B into the WSS COMs, 2×2
  50/50 back to A/B); TMUX-C-32 (ILA-CL without L band and SIG-side OSC; PA-SWG-C, BA-SWG-C 24 dBm; OTDR 38 dB on 2
  fibers); ILAD-C-32 (ILA-CL without L band); ILAD-C-DGE-32 (DGE-CL without L band); TMUX-C32-32 or RDM-C-9 (IRA-CL
  without L band and ASE; BA-VGA-C 14–22 dB; AUX input −12 to −1.35 dBm, output 6.22 to 12.2 dBm).
- BONE 2.0 C band (pages 93–99): FMUX_32 (32-channel flex grid, 6.25 GHz centre, 12.5 GHz steps, 50–500 GHz channels,
  0–15 dB per channel; up IL 4.5 dB, drop 5.5 dB, WSS 9.5 dB; SIGA/SIGB through a 2×2 coupler to COM1/COM2 for 64
  channels with 1+1; DWDM SFP 191.2 THz TBD toward SIG; channel ASE injection; HR or UWB OCM); IRA_32 (PA and BA
  24.5 dBm, ASE 19 dBm into the WSS, WSS IL 9 dB, DWDM SFP toward EXP); TILA (2 × 24.5 dBm; as a terminal amp its
  LINE_WEST APSD and OSC are off); DGE (2×ILA-SWG-C 24.5 dBm, twin DGE, OTDR 40 dB on 4 fibers). New: intra-node and
  degree-to-degree link discovery, ASE injection, auto power control, cascades, OMSP or OCHP; up to 32 dB span loss.
- RAMAN-CL-16 (Polaris R3.6.0B, page 60): PN 60G410001; backward C+L pump at 1425, 1435, 1446, 1463, 1492, 1499 nm;
  10–17 dB gain in 0.1 dB steps; spans up to 42 dB; its own OSC at 191.15 THz (1568.36 nm), 100FX, ≥44 dB port to
  port, in the pump's direction; APSD on the line (the Raman's triggers the EDFA's), APR on LINE in and SIG out. OTM
  and ROADM nodes take one, ILA and DGE nodes one or two; a pair per span.
- FGA (Tencent R3.1.0T, page 33): 10 dB add amplifier, 0–15 dB VOA after it, 18 dBm at LINE; lets a T2X4C8's 64 ×
  75 GHz channels (MUX64) into an AWCL.

### Transponder and muxponder cards

- 800MX / L3X8C7: ten QSFP-DD800 cages; module power by port 1, 5, 6, 10: 32 W (the DCO ports), 3, 8: 25 W, 2, 4, 7,
  9: 12 W; two Microchip META-DX2+ PM6214 gearboxes with OTN; 11 RGB LEDs; 300 W; DCO FTCE3326R1PCL (800G 123.8 GBd
  mPCS SDFEC, 600G 118 GBd 8QAM, 400G 118 GBd QPSK OFEC ZR+, 400G 80 GBd 8QAM OFEC ZR+, 400G 85 GBd 16QAM-PS OFEC ZR+
  TBD); clients 800GE (800GAUI-8, DR8 later), 400GE FR4, 100GE CWDM4/LR4. Modes: 8×100GE or 2×400GE ↔ 800G OPMODE
  140; 4×100GE or 400GE ↔ ITU400-16QAMPS-85G-SDFEC OPMODE 105; ↔ ZR400G-OFEC-QPSK OPMODE 103; 6×100GE ↔
  ZR600G-OFEC-8QAM OPMODE 150; ZR400-16QAMSS-60G-OFEC OPMODE 102 for L3X8C7 in R3.5.1 (page 87). Polaris uses only the
  800G DCO, also for 400G line modes. Regen: four 800G simplex one-way. 3 groups 2×400GE ↔ 800G shown in R3.5.0B,
  served in R3.6.0B.
- 800MX_MACSEC: MACsec client to line at 100/400/800GE; IEEE 802.1AE-2018, AEbn (256-bit), AEbw (XPN); GCM-AES-128/256
  and XPN; 2048 SecYs, 2048 SCs, 4096 SAs per direction; bypass modes; FIPS-197 CAVP A6777.
- L1X12C8 / T1X12C8: line L1 400G–1200G (CIM8), clients C1–C8: QSFP112 at C1, C2, C7, C8, QSFP56/28 at C3–C6; C1–C4
  on PHY1, C5–C8 on PHY2; Tx max 10 dBm C, 8 dBm L; 200 W. Modes: 8×100GE or 2×400GE ↔ 800G OPMODE 54;
  4×100GE/400GE ↔ 400G-16QAMPS-90G-SDFEC OPMODE 55, ↔ 400G-16QAMPS-128G-SDFEC OPMODE 56; 6×100GE ↔ 600G-16QAMPS-138G-SDFEC
  OPMODE 57. Tencent datapaths via ODUflex to 400/600/800G ENH-ZR, 3×400GE ↔ 1200G after grey.
- T1X8C8 (Tencent R3.2.0T): 40 × 102.5 × 274 mm; Marvell x9340P gearboxes; QSFP-DD at cages 1 and 7 (8 SerDes) and
  2 and 8 (4), QSFP28 at 3–6; modes ITU800G-16QAMPS-132G-OFEC (8×100GE, 2×400GE; 800GE and 4×200GE later),
  ITU400G-16QAMPS-90G-OFEC and -120G-SDFEC (4×100GE, 400GE); −5 to 45 °C at 1800 ft.
- 400MX-S: 4×100GE ↔ 400G-16QAM OpenZR+ SS (OPMODE 102) through a gearbox; L1 QSFP-DD up to 25 W, C1–C4 QSFP28 up to
  7.2 W; line 400G PRBS BERT.
- T4B4 (page 123): 1 slot, 1 CFP2 line + 4 QSFP28 clients; line modes and OSNR: 400G 16QAM HP SD-FEC 22.8 dB, 400G
  16QAM PS 67G 21.8 dB, 300G 16QAM PS 67G 18.8 dB, 200G QPSK 14.5 dB, 200G 16QAM PS 16.8 dB, 200G 16QAM 19.0 dB, 100G
  QPSK 11.3 dB, 400G OFEC OpenZR+ 23.5 dB, 300G 8QAM OFEC 20 dB, 200G QPSK OFEC 15 dB, 100G QPSK OFEC 12 dB, 100G
  dQPSK SC-FEC 16 dB. Clients 100GE (with or without KP4 FEC), OTU4 (RS-FEC), 100G FlexE.
- T2B2 (page 124): 1 CFP2 line (200G QPSK, 200G 16QAM PS, 200G 16QAM, 100G QPSK) + 2 QSFP28 clients (C1, C3).
- M10Q2B2 (page 125): 2 slots; 1 CFP2-DCO (200G QPSK/16QAM OTUC2, 100G QPSK OTU4; SD-FEC, OFEC, Staircase), 2
  QSFP-DD (100G DCO only, HwRdy), 2 QSFP28/QSFP+ clients, 12 SFP+ (10GE, OTU2/2e, any rate 5–14G HwRdy); ODU2/2e SNC
  N/I/S protection; −5 to 48 °C.

### Protection cards

- OP3 (Tencent): OCH 1+1, three units, switches on optical power at A and B and on SF/SD from the muxponder's line;
  also in regen nodes with AWL and MUX-PANEL-96.
- OLP3-3 (Polaris C+L): three 1+2 units; ports A, B, C and SIG; under 50 ms; absolute or relative switch,
  revertive or not, hold-off, commands; SF/SD from optical power or the L1 card's diagnosis.
- OLP3 (Polaris C band): OLP3-3 with port C, its LED and PD removed and a 50:50 coupler instead of 33:33:33; firmware
  and FPGA unchanged, so the state machine keeps alternate 2 in lockout.

## Passive panels

| Panel | Front | Rear | Grid / loss | Pages |
| --- | --- | --- | --- | --- |
| MUX-PANEL-96 (2RU, 300 mm rack) | 96 DLP LC D1M1–D96M96 | MPO1–4 (each lane split to 2 LC: 1–64), EMUX1–4 (1 lane to 1 LC: 65–96); RJ-45 MUX | – | 23 |
| MUX-PANEL-64-CL (2RU) | 64 LC: MD1–32 C+L (Pantone Green C), MD33–48 C only (141 C), MD49–64 L only (801 C) | MPO1–3; RJ-45 MUX | IL <4.5 dB MPO1–2, <5 dB MPO3 | 24 |
| MUXPANEL-32C32L (2RU) | 64 LC: MD1–32 C, MD33–64 L; MPO1–4 | RJ-45 MUX | IL <1.6 dB C | 46 |
| P-B64 (2RU, BONE 1.0) | 64 inner-shutter DLP LC D1M1–D64M64 | MPO1–8, RJ-45 EXT | – | 73 |
| MUXPANEL-64 (2RU, BONE 2.0) | 64 inner-shutter DLP LC D1M1–D64M64, MPO1–8 | RJ-45 EXT | – | 100 |
| MUX64 / P-MUX-C64 (2RU, PN 60GP20001, EQPT PMUXC64) | MUXDMUX + 64 MD (inner-shutter DLC) | RJ-45 MUX | two 75 GHz AWGs, 191.3625 + n × 0.075 THz, n = 0–63 | 34, 91, 101 |
| MUX-32 (1RU) | MUXDMUX + 32 MD | RJ-45 MUX | 150 GHz, 191.4000 + n × 0.150 THz, n = 0–31 (drawn as 300 GHz AWGs with interleavers; the text says two 75 GHz AWGs) | 102 |
| MUX-48 (CTC, 1RU) | 48 channels 191.4–196.1 THz, 100 GHz, MON port 98/2 | EEPROM interface | 3 dB bandwidth > 77 GHz | 121 |

P-MUX-C64 colours: chassis RAL 7031, faceplate NCS S3005-R80B, port labels Pantone Green C and RAL 9003.

MPO-24 as the cards and panels use it, looking toward the connector: pins 3–10 are In8, In6, In4, In2, In1, In3, In5,
In7; pins 15–22 are Out8, Out6, Out4, Out2, Out1, Out3, Out5, Out7; pins 1, 2, 11–14, 23, 24 are not used.
MPO-12 (the AWCL's MF): pin 8 Back-C, 7 Back-L, 6 ASE-L, 5 ASE-C, 4 OCM-L, 3 OCM-C; 1, 2, 9–12 not used.

Panel RJ-45s: MUX (rear) pin 3 one-wire, 4 and 5 GND, 6 present, the rest unused; EXT (front) pin 1 I2C SCK, 2 I2C
data (printed IIC_SDK), 3 one-wire, 4 and 5 GND, 6 present, 7 and 8 12 V.

## Nodes and fibers

- Tencent C+L (page 26): OTM = C+L ROADM + mux panel; ILA = C+L ILA with middle-stage loopback; ROADM = C+L ROADM; DGE
  = two C+L ROADMs. L band: the same with an L ROADM and a C ASE source.
- Polaris C+L (page 43): OTS chassis for terminals (xponders with 1+2 protection), OLS chassis for ROADM (C+L flex-grid
  mux/demux with amplifiers + passive C/L MUXPANEL; express + add/drop, add/drop only, or express only), ILA, DGE.
- Cascaded IRA-CL (page 63): a second IRA-CL's LINE into the first one's EXP (EXP8 by default), two MUXPANEL-32C32L,
  up to 63C + 63L add/drop, managed from the first IRA-CL.
- BONE 1.0 C band (page 68): OTM = TMUX-C64 + 2 TMUX-C-32 + P-B64; ILA = ILAD-C-32; DGE = ILAD-C-DGE-32; ROADM = RDM-C-9
  + TMUX-C-32, or IRA-C.
- OTM with OMSP 1+1 (page 83): TMUX-C64 MPO1–MPO8 to P-B64 MPO1–MPO8 (24-pin type A MPO jumpers); TMUX-C64 A and B to
  the two TMUX-C-32s' SIG (LC jumpers); P-B64's RJ-45 to the chassis's MUX port.
- 75 GHz C band OMSP/OCHP (pages 64, 88–90): P-MUX-C64 → OLP3 (or OLP3-3 for 1+2) → TMUX-C-32 per path.

## Power control

- Order when several run on one module (page 57): span loss adaptation, then tilt control, then channel power
  adjustment or DGE.
- Objects: span loss adaptation (the downstream amp in gain mode); span loss deficiency (manual egress VOA); tilt
  (OCM + tilt VOA, once and manual); channel power (OCM + WSS attenuation); auto channel DGE.
- Set-up (page 56): set OTM target gain and tilt 0, run channel power adjustment once; set output tilt, run tilt once;
  calibrate; per direction and link enable span loss adaptation; run tilt once at ILA/DGE/ROADM; enable channel power
  adjustment at OTM, ROADM and DGE. A span loss change or pump degrade: the downstream ILA/PA adapts, then signals by
  OSC for the first DGE/ROADM (add) to rebalance. A terminal channel change: auto adjustment at the OTM IRA.

## ASE filling

- Tencent (pages 28–29, AWL R2.6.0, AWCL R3.0.0T): band-level fast fill through the PA middle stage on line-input LOS
  (LOS → switch → stable in under 5 ms typical, 10 ms max; the service may drop under 50 ms end to end), per band on or
  off; channel-level fill before the BA, 12.5 GHz guard band, through the WSS 33rd add port (normal) or AUX from an
  external FAI (fast, future); manual or auto; force, auto, revertive with WTR, hold-off, SF band or channel.
- Polaris (page 66): channel fill for a missing service, a transmission fiber break and a break between degrees
  (R3.4.0B, manual); unused-channel fill at the OTM; band fill at the OTM drop side later. A regen node's IRA works as
  an OTM.

## Power budgets (BONE 2.0, pages 103–107)

| Scenario | DCO Tx | DCO Rx | Notes |
| --- | --- | --- | --- |
| OTM, fixed 150 GHz | 3 dBm (−7 dBm with OCHP) | 2.5 dBm | AWG IL 6.5 dB; TILA gain 22.5 / 12.5 dB; +9 dBm per channel |
| OTM, fixed 150 GHz + OMSP | −1 dBm | −2.9 dBm | OLP IL 6.2 dB out, 1.9 dB in; gain 22.7 dB; +9 dBm per channel |
| ROADM with add/drop | −1 or +3 dBm | +0.7 dBm | gain 18.3 / 14.3 dB; WSS IL 7.5 dB; +9 dBm per channel |
| OTM 64 A/D with OMSP | −1 dBm | −10.8 dBm | FMUX add 4.5 dB, drop 5.5 dB, WSS 9.5 dB; panel 0.8 dB; gain 20.8 dB; +5 dBm per channel |
| ROADM 64 A/D + OCHP | −1 dBm | −21.7 dBm | IL 9 dB, 7.5 dB, 0.8 dB; gain 32 / 7 dB; +3 dBm per channel |

## Other platforms

- Tencent KAPELLA (page 41): 1RU, 440 × 460 × 44 mm, under 18 kg, over 1500 W front-to-rear cooling (4+1 fans), PSU
  1+1 (AC/HVDC or 48 V DC); 32 OSFP cages (16 top for 30 W coherent OSFP, 16 bottom for grey); NMS, console and USB;
  an integrated 150G mux/demux with 2 MPOs (8 channels each) and an LC MUXDEMUX port, a PD per channel and direction.
- Tencent POLS (page 39): IPoDWDM with 800G Coherent Lite DCOs (1.6T later) on LCH08; QSFP-EDFA-1 (60P330001) and
  QSFP-EDFA-2 (60P280001).
- OLS1000 TPC4/OPC4 (pages 109–119): 2RU, 440 × 88 × 470 mm, 19-inch 600 mm rack; 110/220 V AC, 230 V DC or −48 V DC;
  4 service slots (single or double width); CU 1+1 (NXP i.MX 8M, LPDDR4 2 GB, eMMC + SD, Cyclone 10 FPGA), PSU 1+1
  (550 W OLS, 800 W OTS), fans 2+1, display panel with USB-C, ETH (local craft) and CON (RS-232 115200 8N1); MUX and
  NMS ports at the back. Cards: OA-SWG, ILA-SWG (gain 7–32 dB, NF under 6.5 dB above 15 dB gain), OPS (under 50 ms,
  power −30 to 25 dBm), CMUX-64, T2X4C8 (2 × 400G CFP2-DCO), WSS-9, OPS-6; mux chassis with 48, 64 or 96 fixed
  channels.
- FMD (page 127): twin 2×32 WSS A and B, OA1/OA2, VOAs, 50:50 couplers, a switch to a transceiver, PD and OCM monitors.
