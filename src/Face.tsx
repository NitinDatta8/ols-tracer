// Fronts as the product deck draws them (catalog/common/faceplates.json): the picture, with what goes on each slot or
// port placed over it, in percent of the picture so it holds at any size. Used by the physical view and the canvas.
import { Fragment, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { strandsAt } from './ports';
import type { Box, FacePort, Faceplate, LinecardDef, PortDef, Strand } from './types';

/** A link as is, or a file under public/. */
export const asset = (path: string) => (/^https?:/.test(path) ? path : import.meta.env.BASE_URL + path);

/** Places an element over a faceplate picture at `box`. */
export const at = ({ size: [w, h] }: Faceplate, [x, y, bw, bh]: Box): CSSProperties =>
  ({ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%`, width: `${(bw / w) * 100}%`, height: `${(bh / h) * 100}%` });

/** Places an element inside one over `outer` at `box`, both in the picture's pixels. */
export const inside = ([ox, oy, ow, oh]: Box, [x, y, w, h]: Box): CSSProperties =>
  ({ left: `${((x - ox) / ow) * 100}%`, top: `${((y - oy) / oh) * 100}%`, width: `${(w / ow) * 100}%`, height: `${(h / oh) * 100}%` });

/**
 * Where a port's strands go on the picture: over its connector's halves, or where its Tx and Rx are; in a cage, low on
 * the module in it, leaving its top to click for its datasheet.
 */
export function strandBoxes(f: FacePort, module: boolean): Partial<Record<Strand, Box>> {
  if (!module || !f.box || f.tx || f.rx) return strandsAt(f);
  const [x, y, w, h] = f.box;
  return { tx: [x + w * 0.1, y + h * 0.5, w * 0.38, h * 0.42], rx: [x + w * 0.52, y + h * 0.5, w * 0.38, h * 0.42] };
}

/** The smallest box around all of `boxes`. */
export function around(...boxes: Box[]): Box {
  const [x, y] = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1]))];
  return [x, y, Math.max(...boxes.map((b) => b[0] + b[2])) - x, Math.max(...boxes.map((b) => b[1] + b[3])) - y];
}

/** A faceplate picture with `children` over it, placed with `at`; as wide as it is laid out, as high as its picture. */
export function Art({ face, className = '', style, children, ...rest }: { face: Faceplate } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`art ${className}`} style={{ aspectRatio: `${face.size[0]} / ${face.size[1]}`, ...style }} {...rest}>
      <img src={asset(face.image)} alt="" draggable={false} />
      {children}
    </div>
  );
}

/** A card the deck draws, its faceplate given. */
export type Faced = LinecardDef & { faceplate: Faceplate & { ports: NonNullable<Faceplate['ports']> } };
export const faced = (lc?: LinecardDef): lc is Faced => !!lc?.faceplate?.ports;

/** The ports of a card on its front, as many as its faceplate has, else all of them. */
export const frontPorts = (lc: LinecardDef) => (faced(lc) ? lc.ports.filter((p) => lc.faceplate.ports[p.id]) : lc.ports);

/**
 * A card's faceplate with each of its ports on it drawn by `port`, given where the port is (its connector or cage) and
 * its place on the picture. A port of the card's not on the faceplate is inside the card and not drawn.
 */
export function CardFace({ card, port, ...rest }: { card: Faced; port: (p: PortDef, box: Box, f: FacePort) => ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <Art face={card.faceplate} {...rest}>
      {frontPorts(card).map((p) => {
        const f = card.faceplate.ports[p.id];
        return <Fragment key={p.id}>{port(p, f.box ?? around(...Object.values(strandsAt(f)).filter((b) => !!b)), f)}</Fragment>;
      })}
    </Art>
  );
}
