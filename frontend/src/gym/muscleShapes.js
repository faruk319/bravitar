/**
 * A simplified front/back figure. Each muscle owns one or more shapes, so the
 * same value colours both sides of a symmetric pair. Coordinates are in the
 * 320x340 viewBox the muscle map renders into.
 */

const r = (x, y, w, h) => ({ type: 'rect', x, y, width: w, height: h })
const e = (cx, cy, rx, ry) => ({ type: 'ellipse', cx, cy, rx, ry })

// Not muscles — drawn in a neutral tone so the figure reads as a body.
export const FRAME_SHAPES = [e(80, 26, 15, 19), e(240, 26, 15, 19)]

export const FRONT_MUSCLES = {
  neck: [r(72, 42, 16, 10)],
  shoulders: [e(50, 64, 14, 10), e(110, 64, 14, 10)],
  chest: [r(58, 56, 20, 24), r(82, 56, 20, 24)],
  biceps: [r(34, 76, 13, 30), r(113, 76, 13, 30)],
  forearms: [r(30, 108, 12, 32), r(118, 108, 12, 32)],
  abs: [r(68, 84, 24, 36)],
  obliques: [r(57, 86, 9, 30), r(94, 86, 9, 30)],
  abductors: [r(50, 124, 9, 26), r(101, 124, 9, 26)],
  quads: [r(60, 124, 16, 50), r(84, 124, 16, 50)],
  adductors: [r(77, 126, 6, 32)],
  calves: [r(62, 180, 14, 38), r(84, 180, 14, 38)],
}

export const BACK_MUSCLES = {
  neck: [r(232, 42, 16, 10)],
  shoulders: [e(210, 64, 14, 10), e(270, 64, 14, 10)],
  upper_back: [r(218, 54, 44, 24)],
  lats: [r(214, 80, 22, 28), r(244, 80, 22, 28)],
  triceps: [r(194, 76, 13, 30), r(273, 76, 13, 30)],
  forearms: [r(190, 108, 12, 32), r(278, 108, 12, 32)],
  lower_back: [r(226, 110, 28, 22)],
  glutes: [r(220, 134, 19, 22), r(241, 134, 19, 22)],
  hamstrings: [r(222, 158, 16, 44), r(242, 158, 16, 44)],
  calves: [r(223, 204, 14, 36), r(243, 204, 14, 36)],
}

export const VIEWBOX = '0 0 320 250'
