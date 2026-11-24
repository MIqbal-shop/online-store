// Rounds money values to 2 decimal places, fixing the classic floating point
// drift (e.g. 177068.59000000003) that shows up after repeated add/multiply
// operations on prices.
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Splits a whole piece count into whole cartons + leftover pieces, e.g.
// splitPieces(5, 2) -> { cartons: 2, pcs: 1 } instead of a fractional
// "2.5 cartons", which doesn't mean anything to someone counting stock.
function splitPieces(pieces, piecesPerCarton) {
  const ppc = piecesPerCarton || 1;
  const total = Math.round(Number(pieces) || 0);
  const cartons = Math.floor(total / ppc);
  const pcs = total - cartons * ppc;
  return { cartons, pcs };
}

// Splits a whole piece count into cartons + (for carton->box->piece packed
// products) boxes + leftover pieces, e.g. a product packed 6 box/carton x
// 6 pcs/box with 67 pieces in stock -> { cartons: 1, boxes: 5, pcs: 1 }
// instead of the flat "1 carton, 31 pcs" you'd get from splitPieces alone -
// 31 loose pieces means nothing to someone counting shelves, 5 full boxes +
// 1 loose piece does. Plain carton->piece products (no box tier) get boxes:
// null and behave exactly like splitPieces.
function splitStock(pieces, product) {
  const ppc = product.pieces_per_carton || 1;
  const total = Math.round(Number(pieces) || 0);
  const cartons = Math.floor(total / ppc);
  const leftoverPieces = total - cartons * ppc;

  if (product.packing_type === 'carton_box_piece' && product.boxes_per_carton && product.pieces_per_box) {
    const ppb = product.pieces_per_box;
    const boxes = Math.floor(leftoverPieces / ppb);
    const pcs = leftoverPieces - boxes * ppb;
    return { cartons, boxes, pcs };
  }
  return { cartons, boxes: null, pcs: leftoverPieces };
}

module.exports = { round2, splitPieces, splitStock };
