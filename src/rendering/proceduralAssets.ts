import { FighterDefinition, FighterId } from '../types/game';

/**
 * Generates a crisp, bespoke SVG data-URI avatar icon for each of the 16 stickman fighters,
 * featuring full-body solid signature stickman coloring on a clean white badge.
 */
export function generateProceduralIconDataUrl(def: FighterDefinition): string {
  const emblem = getWeaponEmblemSvg(def.id, def.color, def.accentColor);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96">
    <circle cx="48" cy="48" r="44" fill="#ffffff" stroke="${def.color}" stroke-width="5"/>
    <!-- Full-Body Solid Colored Classic Stickman -->
    <circle cx="36" cy="28" r="9.5" fill="${def.color}"/>
    <path d="M36 39 L36 64 M36 45 L23 57 M36 45 L52 50 M36 64 L26 83 M36 64 L46 83" stroke="${def.color}" stroke-width="5" stroke-linecap="round" fill="none"/>
    <!-- Signature Weapon / Ability Silhouette -->
    ${emblem}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getWeaponEmblemSvg(id: FighterId, c1: string, c2: string): string {
  switch (id) {
    case 'long_sword':
      return `<path d="M48 56 L80 16" stroke="#334155" stroke-width="5" stroke-linecap="round"/><path d="M44 51 L54 59" stroke="#0f172a" stroke-width="4" stroke-linecap="round"/>`;
    case 'sniper':
      return `<path d="M38 48 L84 48" stroke="#0f172a" stroke-width="5" stroke-linecap="round"/><rect x="52" y="41" width="13" height="4" fill="#0f172a"/>`;
    case 'glass':
      return `<rect x="58" y="22" width="10" height="54" fill="${c1}" fill-opacity="0.65" stroke="${c1}" stroke-width="2"/><rect x="71" y="30" width="9" height="46" fill="${c2}" fill-opacity="0.7" stroke="${c1}" stroke-width="2"/>`;
    case 'plier':
      return `<path d="M48 53 L65 45 M48 45 L65 53" stroke="#1e293b" stroke-width="4.5" stroke-linecap="round"/><path d="M64 44 C78 35 84 43 76 48 M64 54 C78 63 84 55 76 50" stroke="#0f172a" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    case 'blue_fire':
      return `<path d="M65 66 C52 56 55 36 66 22 C70 36 80 41 75 56 C73 62 69 66 65 66 Z" fill="#0b3be0"/><path d="M65 63 C58 56 60 44 66 34 C68 43 73 47 70 57 Z" fill="${c2}"/>`;
    case 'magnet':
      return `<path d="M56 36 L68 36 A11 11 0 0 1 68 58 L56 58" fill="none" stroke="${c1}" stroke-width="6" stroke-linecap="round"/><rect x="52" y="33" width="7" height="6" fill="#ef4444"/><rect x="52" y="55" width="7" height="6" fill="#3b82f6"/>`;
    case 'portal':
      return `<ellipse cx="66" cy="36" rx="7" ry="13" fill="none" stroke="#f97316" stroke-width="4"/><ellipse cx="66" cy="64" rx="7" ry="11" fill="none" stroke="#0ea5e9" stroke-width="4"/>`;
    case 'rubber':
      return `<path d="M50 52 Q64 42 74 32" stroke="${c1}" stroke-width="7" stroke-linecap="round" fill="none"/><circle cx="75" cy="31" r="6" fill="${c1}"/>`;
    case 'gravity':
      return `<circle cx="66" cy="48" r="7" fill="${c1}"/><ellipse cx="66" cy="48" rx="16" ry="7" transform="rotate(-28 66 48)" fill="none" stroke="${c2}" stroke-width="3"/>`;
    case 'bulwark':
      return `<rect x="54" y="22" width="18" height="52" rx="3" fill="${c1}" stroke="#0f172a" stroke-width="3"/><line x1="63" y1="27" x2="63" y2="69" stroke="${c2}" stroke-width="2.5"/>`;
    case 'clone':
      return `<circle cx="62" cy="31" r="8" fill="${c1}" fill-opacity="0.55"/><path d="M62 40 L62 63 M62 46 L74 53" stroke="${c1}" stroke-width="4" stroke-opacity="0.55" stroke-linecap="round"/>`;
    case 'thunder':
      return `<polygon points="67,20 53,47 64,47 57,74 77,42 65,42" fill="#fde047" stroke="${c1}" stroke-width="2"/>`;
    case 'ice':
      return `<path d="M65 25 L65 69 M48 37 L82 57 M82 37 L48 57" stroke="${c1}" stroke-width="3.5" stroke-linecap="round"/>`;
    case 'black_hole':
      return `<ellipse cx="65" cy="48" rx="17" ry="6" transform="rotate(-20 65 48)" fill="none" stroke="${c2}" stroke-width="3.5"/><circle cx="65" cy="48" r="9" fill="#090d16" stroke="${c1}" stroke-width="2.5"/>`;
    case 'rocket':
      return `<rect x="44" y="38" width="36" height="12" rx="3" transform="rotate(-12 61 43)" fill="${c1}" stroke="#0f172a" stroke-width="2.5"/><circle cx="79" cy="39" r="4" fill="#f97316"/>`;
    case 'hammer':
      return `<line x1="48" y1="66" x2="69" y2="32" stroke="#78350f" stroke-width="5" stroke-linecap="round"/><rect x="56" y="19" width="26" height="17" rx="2" transform="rotate(30 69 29)" fill="${c1}" stroke="#0f172a" stroke-width="2.5"/>`;
    case 'scythe':
      return `<line x1="46" y1="74" x2="70" y2="22" stroke="#1e293b" stroke-width="4.5" stroke-linecap="round"/><path d="M68 23 C86 24 88 44 72 52 C78 39 75 30 66 28 Z" fill="${c1}" stroke="#0f172a" stroke-width="2"/>`;
    case 'boomerang':
      return `<path d="M54 24 Q78 48 54 72 Q66 48 54 24 Z" fill="${c1}" stroke="#0f172a" stroke-width="2.5" stroke-linejoin="round"/>`;
    case 'chainsaw':
      return `<rect x="46" y="42" width="16" height="14" rx="2" fill="${c1}" stroke="#0f172a" stroke-width="2.5"/><rect x="61" y="45" width="24" height="8" rx="3" fill="#cbd5e1" stroke="#0f172a" stroke-width="2"/>`;
    case 'sonic':
      return `<path d="M56 38 A14 14 0 0 1 56 58 M64 31 A22 22 0 0 1 64 65 M72 24 A30 30 0 0 1 72 72" fill="none" stroke="${c1}" stroke-width="3.5" stroke-linecap="round"/>`;
    case 'venom':
      return `<line x1="46" y1="64" x2="76" y2="24" stroke="#365314" stroke-width="4" stroke-linecap="round"/><polygon points="78,20 68,28 74,34" fill="${c1}"/><circle cx="76" cy="44" r="3.5" fill="${c1}"/>`;
    case 'wind':
      return `<path d="M52 54 L62 24 A26 26 0 0 1 84 48 Z" fill="${c2}" stroke="${c1}" stroke-width="3"/><path d="M56 64 Q72 58 80 68" fill="none" stroke="${c1}" stroke-width="3" stroke-linecap="round"/>`;
    case 'spear':
      return `<line x1="44" y1="72" x2="76" y2="24" stroke="#7f1d1d" stroke-width="4.5" stroke-linecap="round"/><polygon points="82,15 70,25 78,30" fill="#cbd5e1" stroke="#0f172a" stroke-width="2"/>`;
    case 'whip':
      return `<path d="M48 50 C60 30 68 68 78 36 C82 26 85 32 82 42" fill="none" stroke="${c1}" stroke-width="4" stroke-dasharray="5 2" stroke-linecap="round"/>`;
    case 'laser':
      return `<rect x="46" y="44" width="24" height="9" rx="2" fill="#1e293b"/><polygon points="70,44 79,48.5 70,53" fill="${c1}"/><line x1="78" y1="48.5" x2="90" y2="48.5" stroke="${c1}" stroke-width="3.5"/>`;
    case 'earth':
      return `<polygon points="56,68 58,32 70,24 82,34 84,68" fill="${c1}" stroke="#292524" stroke-width="2.5"/>`;
    case 'water':
      return `<path d="M52 58 C58 38 74 34 78 24 C84 40 78 64 60 66 Z" fill="${c1}"/><path d="M58 56 C62 45 70 42 73 35 C75 45 71 57 61 59 Z" fill="${c2}"/>`;
    case 'shadow':
      return `<path d="M54 58 C60 32 76 26 82 36 C73 36 66 44 62 58 Z" fill="${c1}" stroke="#0f172a" stroke-width="2"/>`;
    case 'yo_yo':
      return `<line x1="48" y1="49" x2="69" y2="49" stroke="#475569" stroke-width="2.5"/><circle cx="72" cy="49" r="11" fill="${c1}" stroke="#0f172a" stroke-width="2.5"/><circle cx="72" cy="49" r="3.5" fill="#ffffff"/>`;
    case 'anchor':
      return `<line x1="66" y1="24" x2="66" y2="66" stroke="${c1}" stroke-width="5" stroke-linecap="round"/><line x1="56" y1="33" x2="76" y2="33" stroke="${c1}" stroke-width="4" stroke-linecap="round"/><path d="M52 54 Q66 72 80 54" fill="none" stroke="${c1}" stroke-width="5" stroke-linecap="round"/>`;
    case 'time':
      return `<circle cx="67" cy="48" r="15" fill="#fef9c3" stroke="${c1}" stroke-width="3"/><path d="M67 48 L67 37 M67 48 L75 51" stroke="#0f172a" stroke-width="3" stroke-linecap="round"/>`;
    case 'alchemist':
      return `<circle cx="67" cy="53" r="13" fill="${c1}" stroke="#0f172a" stroke-width="2.5"/><rect x="63" y="35" width="8" height="6" fill="#78350f"/><circle cx="63" cy="49" r="3" fill="${c2}"/>`;
  }
}

/**
 * Draws full-scale, articulated 2D vector weapons directly onto the Arena Canvas
 * at lead-hand origin (0, 0) pointing along +X, matching the iconic oversized silhouettes
 * of classic stickman weapon tournament animations!
 */
export function drawProceduralWeaponVector(
  ctx: CanvasRenderingContext2D,
  fighterId: FighterId,
  options: {
    broken?: boolean;
    severedTipOnly?: boolean;
    blueFireCoated?: boolean;
    spinning?: boolean;
    attackProgress?: number;
    timeSec?: number;
  } = {}
): void {
  const {
    broken = false,
    severedTipOnly = false,
    blueFireCoated = false,
    spinning = false,
    attackProgress = -1,
    timeSec = 0,
  } = options;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Mystic Blue Fire Ignited Weapon Coating (exact roaring blue blade flame like 01:11 in video!)
  const isLongWeapon =
    fighterId === 'long_sword' ||
    fighterId === 'spear' ||
    fighterId === 'scythe' ||
    fighterId === 'hammer' ||
    fighterId === 'anchor' ||
    fighterId === 'chainsaw' ||
    fighterId === 'sniper';
  if (blueFireCoated && fighterId !== 'blue_fire' && fighterId !== 'water' && fighterId !== 'ice') {
    const flameLen = broken ? 32 : isLongWeapon ? 114 : 46;
    ctx.save();
    ctx.fillStyle = 'rgba(11, 59, 224, 0.78)';
    ctx.beginPath();
    ctx.moveTo(2, -4);
    for (let fx = 8; fx <= flameLen; fx += 12) {
      const jag = 10 + Math.sin(timeSec * 32 + fx * 0.22) * 7;
      ctx.lineTo(fx, -jag);
    }
    ctx.lineTo(flameLen + 10, 0);
    for (let fx = flameLen; fx >= 8; fx -= 12) {
      const jag = 9 + Math.cos(timeSec * 29 + fx * 0.2) * 6;
      ctx.lineTo(fx, jag);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.beginPath();
    ctx.moveTo(4, -2);
    for (let fx = 10; fx <= flameLen * 0.9; fx += 14) {
      const jag = 5 + Math.cos(timeSec * 36 + fx * 0.3) * 4;
      ctx.lineTo(fx, -jag);
    }
    ctx.lineTo(flameLen * 0.92, 0);
    ctx.lineTo(4, 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  switch (fighterId) {
    case 'long_sword': {
      // Spinning blade fan blur disc (01:01–01:02 in video!)
      if (spinning && !broken) {
        const grad = ctx.createRadialGradient(10, 0, 12, 10, 0, 122);
        grad.addColorStop(0, 'rgba(226, 232, 240, 0.05)');
        grad.addColorStop(0.7, 'rgba(148, 163, 184, 0.36)');
        grad.addColorStop(1, 'rgba(71, 85, 105, 0.55)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(10, 0, 122, 0, Math.PI * 2);
        ctx.fill();
      }

      if (severedTipOnly) {
        // Severed upper blade fragment tumbling onto the floor!
        ctx.fillStyle = '#cbd5e1';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-38, -3);
        ctx.lineTo(42, -2);
        ctx.lineTo(52, 0.5);
        ctx.lineTo(40, 3);
        ctx.lineTo(-36, 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }

      // Long two-handed wrapped katana hilt (-24 to +4)
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-24, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();

      // Tsuba Crossguard
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(4, -9);
      ctx.lineTo(4, 9);
      ctx.stroke();

      // Iconic Giant Sleek Blade (130px intact, 28px jagged stub if snapped!)
      const bladeLen = broken ? 28 : 130;
      ctx.fillStyle = '#cbd5e1';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(4, -3.2);
      ctx.lineTo(bladeLen - (broken ? 5 : 14), -2.6);
      if (broken) {
        ctx.lineTo(bladeLen, -0.5);
        ctx.lineTo(bladeLen - 4, 3);
      } else {
        ctx.lineTo(bladeLen, 0); // razor tip
        ctx.lineTo(bladeLen - 12, 2.8);
      }
      ctx.lineTo(4, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Dark spine fuller line (classic two-tone blade look from 00:00 & 00:43!)
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(6, -1.2);
      ctx.lineTo(bladeLen - 10, -0.8);
      ctx.stroke();
      break;
    }

    case 'sniper': {
      if (severedTipOnly) {
        // Sliced front barrel + bipod tumbling to the floor (exact 00:17 detail!)
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-34, 0);
        ctx.lineTo(36, 0);
        ctx.moveTo(14, 1);
        ctx.lineTo(4, 12);
        ctx.moveTo(18, 1);
        ctx.lineTo(24, 11);
        ctx.stroke();
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(32, -3, 8, 6);
        break;
      }

      // Buttstock braced back against shoulder (-46 to -8)
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(-46, -2);
      ctx.lineTo(-46, 9);
      ctx.lineTo(-10, 5);
      ctx.lineTo(-10, -4);
      ctx.closePath();
      ctx.fill();

      // Receiver body & Pistol Grip & Magazine (-12 to +24)
      ctx.fillRect(-12, -5, 36, 8);
      ctx.fillRect(-6, 2, 5, 11); // trigger grip
      ctx.fillRect(8, 2, 9, 10); // box mag

      // Raised Optical Sniper Scope (-6 to +22)
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-1, -5);
      ctx.lineTo(-1, -10);
      ctx.moveTo(14, -5);
      ctx.lineTo(14, -10);
      ctx.stroke();
      ctx.fillRect(-9, -14, 31, 4.5);
      ctx.fillRect(-12, -15, 4, 6.5);
      ctx.fillRect(20, -15.5, 5, 7.5);

      if (!broken) {
        // Long high-caliber barrel (+24 to +94) + Muzzle Brake + Folded Bipod!
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(24, -1.5);
        ctx.lineTo(92, -1.5);
        ctx.stroke();

        // Under-barrel gas tube & bipod legs (exact silhouette from 00:08–00:13!)
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(24, 2.5);
        ctx.lineTo(68, 2.5);
        ctx.moveTo(64, 2.5);
        ctx.lineTo(78, 8);
        ctx.stroke();

        // Muzzle brake
        ctx.fillRect(89, -4, 9, 5.5);
      } else {
        // Sliced jagged stub!
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(24, -5);
        ctx.lineTo(28, 3);
        ctx.stroke();
      }
      break;
    }

    case 'plier': {
      // Giant Heavy Industrial Pincer / Bolt-Cutter (00:26–00:31 in video!)
      // Jaw open angle: opens wide at start of chomp, snaps tightly shut at midpoint!
      let jawOpen = 0.28 + Math.sin(timeSec * 5) * 0.08;
      if (attackProgress >= 0) {
        jawOpen = attackProgress < 0.35 ? 0.52 : Math.max(0.02, 0.52 * (1 - (attackProgress - 0.35) * 2.2));
      }

      // Twin long heavy black handles (-30 to +28)
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.moveTo(-30, -9);
      ctx.quadraticCurveTo(0, -11, 28, -2);
      ctx.moveTo(-30, 9);
      ctx.quadraticCurveTo(0, 11, 28, 2);
      ctx.stroke();

      // Pivot joint bolt at x = 28
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(28, 0, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.arc(28, 0, 3, 0, Math.PI * 2);
      ctx.fill();

      // Upper Curved Pincer Jaw
      ctx.save();
      ctx.translate(28, 0);
      ctx.rotate(-jawOpen);
      ctx.fillStyle = '#1f2937';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.quadraticCurveTo(32, -22, 62, -4);
      ctx.lineTo(58, 2);
      ctx.quadraticCurveTo(30, -8, 0, 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Lower Curved Pincer Jaw
      ctx.save();
      ctx.translate(28, 0);
      ctx.rotate(jawOpen);
      ctx.fillStyle = '#1f2937';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.quadraticCurveTo(32, 22, 62, 4);
      ctx.lineTo(58, -2);
      ctx.quadraticCurveTo(30, 8, 0, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'glass': {
      // Bare-handed Vitreomancer: subtle floating crystalline shards only during active cast!
      if (attackProgress >= 0) {
        ctx.fillStyle = 'rgba(122, 199, 155, 0.78)';
        ctx.strokeStyle = '#4c9a73';
        ctx.lineWidth = 1.6;
        for (const [ox, oy, sc] of [
          [14, -6, 1],
          [24, 4, 0.8],
          [8, 6, 0.7],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(ox - 6 * sc, oy);
          ctx.lineTo(ox + 4 * sc, oy - 5 * sc);
          ctx.lineTo(ox + 16 * sc, oy);
          ctx.lineTo(ox + 4 * sc, oy + 5 * sc);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      break;
    }

    case 'blue_fire': {
      // Bare-handed Pyromancer: vivid roaring blue flame conjured upright in palm (00:45, 00:47, 01:03 in video!)
      // Counter-rotate so palm flame always flickers skyward naturally!
      const flick1 = Math.sin(timeSec * 26) * 4;
      const flick2 = Math.cos(timeSec * 31) * 3;
      ctx.save();
      // Draw in local hand space slightly ahead of palm
      ctx.translate(8, -4);
      // Outer deep royal-blue flame
      ctx.fillStyle = '#0b3be0';
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.bezierCurveTo(-13, 2, -12, -16, -3 + flick2, -28);
      ctx.lineTo(0, -19);
      ctx.lineTo(4 + flick1, -34);
      ctx.bezierCurveTo(14, -18, 13, 2, 0, 8);
      ctx.closePath();
      ctx.fill();

      // Inner bright cyan core
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(0, 5);
      ctx.bezierCurveTo(-7, 0, -6, -11, 2 + flick1 * 0.5, -21);
      ctx.bezierCurveTo(8, -10, 7, 0, 0, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'magnet': {
      // Oversized Industrial Horseshoe Magnet + live magnetic flux waves
      ctx.lineWidth = 7.5;
      ctx.strokeStyle = '#be185d';
      ctx.beginPath();
      ctx.arc(12, 0, 15, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.fillRect(12, -19, 16, 8);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(12, 11, 16, 8);

      // Pulsing magnetic field arcs
      const pulse = (timeSec * 3) % 1;
      ctx.strokeStyle = `rgba(236, 72, 153, ${0.7 * (1 - pulse)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(28 + pulse * 14, 0, 12 + pulse * 8, -0.8, 0.8);
      ctx.stroke();
      break;
    }

    case 'portal': {
      // Sleek Portal Ring Emitter Gauntlet
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.ellipse(12, 0, 6, 14, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(18, 0, 4, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'rubber': {
      // Heavy Stretchy Pink Rubber Club Baton
      const stretchLen = attackProgress >= 0 ? 74 : 44;
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.quadraticCurveTo(stretchLen * 0.5, Math.sin(timeSec * 16) * 6, stretchLen, 0);
      ctx.stroke();
      ctx.fillStyle = '#db2777';
      ctx.beginPath();
      ctx.arc(stretchLen + 2, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'gravity': {
      // Floating Concentric Telekinetic Gravity Rings around hand
      ctx.fillStyle = '#6d28d9';
      ctx.beginPath();
      ctx.arc(14, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(14, 0, 16, 6, timeSec * 4, 0, Math.PI * 2);
      ctx.ellipse(14, 0, 16, 6, -timeSec * 3.2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'bulwark': {
      if (!broken) {
        // Full-Body Heavy Steel Tower Shield (96px tall!)
        ctx.fillStyle = '#334155';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.roundRect(6, -48, 18, 96, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(11, -40, 7, 80);
      }
      break;
    }

    case 'clone': {
      // Long Sleek Ninja Chokuto / Kunai Blade (68px)
      ctx.strokeStyle = '#1e1b4b';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(4, 0);
      ctx.stroke();
      ctx.fillStyle = '#4338ca';
      ctx.strokeStyle = '#1e1b4b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, -3.5);
      ctx.lineTo(54, -1.5);
      ctx.lineTo(66, 0);
      ctx.lineTo(54, 2.5);
      ctx.lineTo(4, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'thunder': {
      // High-Voltage Twin-Prong Lightning Lance (64px) + Crackling Arcs
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(32, 0);
      ctx.stroke();

      ctx.strokeStyle = '#ca8a04';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(32, -6);
      ctx.lineTo(52, -6);
      ctx.moveTo(32, 6);
      ctx.lineTo(52, 6);
      ctx.stroke();

      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(52, -6);
      ctx.lineTo(58 + (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 6);
      ctx.lineTo(52, 6);
      ctx.stroke();
      break;
    }

    case 'ice': {
      // Cryomancer Frost Crystal Blade / Palm Icicle
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(18, -8);
      ctx.lineTo(52, 0);
      ctx.lineTo(18, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'black_hole': {
      // Hovering Miniature Event Horizon Singularity above palm
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.ellipse(18, 0, 17, 6, -0.35 + timeSec * 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#090d16';
      ctx.beginPath();
      ctx.arc(18, 0, 9.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'rocket': {
      // Heavy 104px Shoulder-Mounted Bazooka Launcher!
      ctx.fillStyle = '#15803d';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.roundRect(-42, -9, 98, 18, 4);
      ctx.fill();
      ctx.stroke();

      // Rear flared exhaust bell
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(-42, -9);
      ctx.lineTo(-52, -13);
      ctx.lineTo(-52, 13);
      ctx.lineTo(-42, 9);
      ctx.closePath();
      ctx.fill();

      // Loaded rocket warhead peeking from muzzle
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(56, -6.5);
      ctx.lineTo(68, 0);
      ctx.lineTo(56, 6.5);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'hammer': {
      // Colossal 112px Two-Handed Seismic Sledge Warhammer!
      ctx.strokeStyle = '#5c2d0c';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-26, 0);
      ctx.lineTo(78, 0);
      ctx.stroke();

      ctx.fillStyle = '#9a3412';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(62, -25, 28, 50, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(67, -20, 6, 40);
      break;
    }

    case 'scythe': {
      // Giant Grim Reaper Crescent Scythe (104px pole + 56px sweeping crimson-edged blade!)
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 5.2;
      ctx.beginPath();
      ctx.moveTo(-28, 0);
      ctx.lineTo(76, 0);
      ctx.stroke();

      // Collar socket
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(68, -5, 10, 10);

      // Sweeping curved reaper blade curving downward (+Y)
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(74, -4);
      ctx.bezierCurveTo(88, 8, 82, 42, 46, 54);
      ctx.bezierCurveTo(66, 38, 69, 14, 68, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Crimson soul-edge highlight
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(74, -2);
      ctx.bezierCurveTo(85, 10, 80, 40, 48, 52);
      ctx.stroke();
      break;
    }

    case 'boomerang': {
      // Giant Curved Aerodynamic Teal Chevron Boomerang!
      ctx.fillStyle = '#0d9488';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(26, 0);
      ctx.quadraticCurveTo(10, -28, -14, -34);
      ctx.quadraticCurveTo(2, -12, 8, 0);
      ctx.quadraticCurveTo(2, 12, -14, 34);
      ctx.quadraticCurveTo(10, 28, 26, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // White aerodynamic wing stripes
      ctx.strokeStyle = '#ccfbf1';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(15, -6);
      ctx.lineTo(-4, -24);
      ctx.moveTo(15, 6);
      ctx.lineTo(-4, 24);
      ctx.stroke();
      break;
    }

    case 'chainsaw': {
      // Heavy Industrial Motorized Chainsaw with Animated Revving Steel Teeth!
      const vibY = Math.sin(timeSec * 55) * 0.9;
      ctx.translate(0, vibY);

      // Rear handle & engine block (-18 to +22)
      ctx.fillStyle = '#ea580c';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-14, -12, 34, 23, 4);
      ctx.fill();
      ctx.stroke();

      // Top roll guard bar
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-4, -12);
      ctx.lineTo(4, -20);
      ctx.lineTo(14, -12);
      ctx.stroke();

      // Long steel guide bar (+20 to +88)
      ctx.fillStyle = '#cbd5e1';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(19, -7, 68, 14, 7);
      ctx.fill();
      ctx.stroke();

      // Animated motorized saw teeth!
      const toothPhase = (timeSec * 36) % 1;
      ctx.fillStyle = '#0f172a';
      for (let tx = 24 + toothPhase * 9; tx < 82; tx += 9) {
        ctx.beginPath();
        ctx.moveTo(tx, -7);
        ctx.lineTo(tx + 4, -11.5);
        ctx.lineTo(tx + 6, -7);
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(tx, 7);
        ctx.lineTo(tx - 4, 11.5);
        ctx.lineTo(tx - 6, 7);
        ctx.fill();
      }
      break;
    }

    case 'sonic': {
      // Futuristic Acoustic Sonic Boom Cannon Gauntlet + Live Soundwave Rings!
      ctx.fillStyle = '#0e7490';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.roundRect(-8, -10, 30, 20, 4);
      ctx.fill();
      ctx.stroke();

      // Flared speaker cone
      ctx.fillStyle = '#22d3ee';
      ctx.beginPath();
      ctx.moveTo(22, -9);
      ctx.lineTo(32, -14);
      ctx.lineTo(32, 14);
      ctx.lineTo(22, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Pulsing concentric acoustic arcs
      const pWave = (timeSec * 3.8) % 1;
      ctx.strokeStyle = `rgba(6, 182, 212, ${0.85 * (1 - pWave)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(32 + pWave * 18, 0, 10 + pWave * 10, -0.75, 0.75);
      ctx.stroke();
      break;
    }

    case 'venom': {
      // Toxic Viper-Fang Glaive dripping corrosive lime acid!
      ctx.strokeStyle = '#365314';
      ctx.lineWidth = 4.8;
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(58, 0);
      ctx.stroke();

      // Twin curved venom fangs
      ctx.fillStyle = '#84cc16';
      ctx.strokeStyle = '#1a2e05';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(54, -3);
      ctx.quadraticCurveTo(72, -12, 86, -2);
      ctx.quadraticCurveTo(70, -3, 56, 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(52, 3);
      ctx.quadraticCurveTo(68, 12, 80, 4);
      ctx.quadraticCurveTo(66, 4, 54, -1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Dripping acid droplet
      const dropY = 5 + ((timeSec * 18) % 9);
      ctx.fillStyle = '#a3e635';
      ctx.beginPath();
      ctx.arc(80, dropY, 2.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'wind': {
      // Giant Folding War Tessen Fan with Aeromancy Gale Swirl!
      ctx.fillStyle = '#ccfbf1';
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 46, -0.78, 0.78);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Bamboo/Iron fan ribs
      ctx.strokeStyle = '#14b8a6';
      ctx.lineWidth = 1.8;
      for (const a of [-0.48, -0.16, 0.16, 0.48]) {
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(Math.cos(a) * 44, Math.sin(a) * 44);
        ctx.stroke();
      }
      break;
    }

    case 'spear': {
      if (severedTipOnly) {
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-20, 0);
        ctx.lineTo(0, -7);
        ctx.lineTo(28, 0);
        ctx.lineTo(0, 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }

      // Long 126px Dragon Halberd Spear!
      const shaftEnd = broken ? 36 : 96;
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-30, 0);
      ctx.lineTo(shaftEnd, 0);
      ctx.stroke();

      if (!broken) {
        // Flowing crimson tassel behind spearhead
        const wave = Math.sin(timeSec * 18) * 5;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(92, 2);
        ctx.quadraticCurveTo(84, 12 + wave, 76, 15 + wave);
        ctx.stroke();

        // Gleaming diamond steel spearhead (+94 to +128)
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(92, 0);
        ctx.lineTo(104, -7.5);
        ctx.lineTo(128, 0);
        ctx.lineTo(104, 7.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'whip': {
      // Articulated Segmented Iron Chain Whip (extends dynamically on attack!)
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();

      const ext = attackProgress >= 0 ? Math.sin(attackProgress * Math.PI) * 95 : 0;
      const totalLen = 54 + ext;
      const links = 8;
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      let tipX = 8;
      let tipY = 0;
      for (let i = 1; i <= links; i++) {
        const t = i / links;
        const lx = 8 + totalLen * t;
        const waveAmp = attackProgress >= 0 ? (1 - t) * 8 : Math.sin(t * Math.PI) * 14;
        const ly = Math.sin(timeSec * 14 + i * 1.1) * waveAmp;
        ctx.lineTo(lx, ly);
        tipX = lx;
        tipY = ly;
      }
      ctx.stroke();

      // Spiked steel dart tip
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(tipX + 3, tipY, 5.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'laser': {
      // Futuristic Rose-Magenta Prism Laser Rifle!
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(-34, -6, 68, 12, 3);
      ctx.fill();
      ctx.stroke();

      if (!broken) {
        // Glowing magenta crystal core & focusing prism emitter
        ctx.fillStyle = '#fb7185';
        ctx.fillRect(-4, -3, 32, 6);

        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.moveTo(34, -8);
        ctx.lineTo(54, 0);
        ctx.lineTo(34, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      break;
    }

    case 'earth': {
      // Jagged Granite Geomancer Gauntlet + Levitating Stone Boulder!
      ctx.fillStyle = '#78350f';
      ctx.strokeStyle = '#292524';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-4, -9);
      ctx.lineTo(16, -12);
      ctx.lineTo(22, 0);
      ctx.lineTo(16, 12);
      ctx.lineTo(-4, 9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      const bob = Math.sin(timeSec * 6) * 3;
      ctx.fillStyle = '#a16207';
      ctx.beginPath();
      ctx.arc(34, bob, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'water': {
      // Swirling High-Pressure Ocean Hydro Crest around casting hand!
      const wave = Math.sin(timeSec * 16) * 3;
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 4.2;
      ctx.beginPath();
      ctx.arc(14, 0, 14, -1.8 + wave * 0.1, 1.4 + wave * 0.1);
      ctx.stroke();

      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(10, -4);
      ctx.quadraticCurveTo(28, -12 + wave, 40, 0);
      ctx.quadraticCurveTo(26, 10 + wave, 10, 4);
      ctx.closePath();
      ctx.fill();
      break;
    }

    case 'shadow': {
      // Sleek Curved Midnight-Indigo Umbra Kama Sickle!
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(28, 0);
      ctx.stroke();

      ctx.fillStyle = '#312e81';
      ctx.strokeStyle = '#818cf8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(24, -2);
      ctx.quadraticCurveTo(46, 2, 34, 28);
      ctx.quadraticCurveTo(32, 12, 20, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'yo_yo': {
      // Tethered Steel Buzzsaw Yo-Yo Disc!
      const reach = attackProgress >= 0 ? 18 + Math.sin(attackProgress * Math.PI) * 34 : 20;
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(reach, 0);
      ctx.stroke();

      ctx.save();
      ctx.translate(reach, 0);
      ctx.rotate(timeSec * 22);
      ctx.fillStyle = '#f43f5e';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Saw notches
      ctx.strokeStyle = '#ffe4e6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-8, 0);
      ctx.lineTo(8, 0);
      ctx.moveTo(0, -8);
      ctx.lineTo(0, 8);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'anchor': {
      // Colossal 98px Naval Iron Ship Anchor + Heavy Chain!
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(68, 0);
      ctx.stroke();

      // Cross-stock bar
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(14, -15);
      ctx.lineTo(14, 15);
      ctx.stroke();

      // Curved twin iron flukes at head (+52 to +76)
      ctx.strokeStyle = '#172554';
      ctx.lineWidth = 6.5;
      ctx.beginPath();
      ctx.arc(54, 0, 22, -1.15, 1.15);
      ctx.stroke();

      // Fluke arrowheads
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.arc(63, -20, 4.5, 0, Math.PI * 2);
      ctx.arc(63, 20, 4.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'time': {
      // Ornate Golden Clock-Hand Rapier with Spinning Clockwork Guard!
      ctx.strokeStyle = '#713f12';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();

      // Golden clockwork dial guard
      ctx.save();
      ctx.translate(8, 0);
      ctx.rotate(timeSec * 2.5);
      ctx.fillStyle = '#fef08a';
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Tapered golden clock-hand needle blade (+16 to +78)
      ctx.fillStyle = '#eab308';
      ctx.strokeStyle = '#713f12';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(14, -3.5);
      ctx.lineTo(78, 0);
      ctx.lineTo(14, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }

    case 'alchemist': {
      // Volatile Round Glass Alchemical Bomb Flask with Fizzing Spark!
      ctx.fillStyle = '#9333ea';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(14, 3, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Glass neck & cork
      ctx.fillStyle = '#e9d5ff';
      ctx.fillRect(10, -12, 8, 6);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(11, -16, 6, 4);

      // Fizzing fuse spark
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(14 + Math.sin(timeSec * 30) * 2, -19, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
