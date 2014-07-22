'use strict';

var Curve3Div = require('./curve3_div');
var Curve4Div = require('./curve4_div');
var rbush = require('rbush');

// calculates the bbox for a line segment from a to b
function bbox(a, b) {
    return [
        /* x1 */ Math.min(a[0], b[0]),
        /* y1 */ Math.min(a[1], b[1]),
        /* x2 */ Math.max(a[0], b[0]),
        /* y2 */ Math.max(a[1], b[1]),
        a,
        b
    ];
}

function pt(x, y) {
    return [x, y];
}

// point in polygon ray casting algorithm
function polyContainsPoint(rings, p) {
    var c = false,
        ring, p1, p2;

    for (var k = 0; k < rings.length; k++) {
        ring = rings[k];
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            p1 = ring[i];
            p2 = ring[j];
            if (((p1[1] > p.y) != (p2[1] > p.y)) && (p.x < (p2[0] - p1[0]) * (p.y - p1[1]) / (p2[1] - p1[1]) + p1[0])) {
                c = !c;
            }
        }
    }
    return c;
}

function squaredDistance(v, w) {
    var a = v[0] - w[0];
    var b = v[1] - w[1];
    return a * a + b * b;
}

function projectPointOnLineSegment(p, v, w) {
  var l2 = squaredDistance(v, w);
  if (l2 === 0) return v;
  var t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
  if (t < 0) return v;
  if (t > 1) return w;
  return [ v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
}

function squaredDistanceToLineSegment(p, v, w) {
    var s = projectPointOnLineSegment(p, v, w);
    return squaredDistance(p, s);
}


function squaredDistanceToUnboundedLineSegment(p, v, w) {
    if (v[0] == w[0] && v[1] == w[1]) {
        return squaredDistance(v, w);
    } else {
        var numerator = ((w[0] - v[0]) * (v[1] - p[1])) - ((v[0] - p[0]) * (w[1] - v[1]));
        return (numerator * numerator) / squaredDistance(v, w);
    }
}


function minDistanceToLineSegment(tree, p, radius) {
    var squaredRadius = radius * radius;
    var segments = tree.search([ p[0] - radius, p[1] - radius, p[0] + radius, p[1] + radius]);
    var squaredDistance = Infinity;
    for (var i = 0; i < segments.length; i++) {
        var segment = segments[i];
        var v = segment[4];
        var w = segment[5];
        var dist = squaredDistanceToLineSegment(p, v, w);
        if (dist < squaredDistance && dist < squaredRadius) {
            squaredDistance = dist;
        }
    }
    return Math.sqrt(squaredDistance);
}

function minDistanceToUnboundedLineSegment(tree, p, radius) {
    var segments = tree.search([ p[0] - radius, p[1] - radius, p[0] + radius, p[1] + radius]);
    var squaredDistance = Infinity;
    var closestSegments = [];
    for (var i = 0; i < segments.length; i++) {
        var segment = segments[i];
        var v = segment[4];
        var w = segment[5];
        var dist = squaredDistanceToLineSegment(p, v, w);
        if (dist < squaredDistance) {
            squaredDistance = dist;
            closestSegments = [[v, w]];
        } else if (dist == squaredDistance) {
            closestSegments.push([v, w]);
        }
    }

    if (closestSegments.length) {
        var dist = -Infinity;
        for (var i = 0; i < closestSegments.length; i++) {
            var s = closestSegments[i];
            var d = Math.abs(squaredDistanceToUnboundedLineSegment(p, s[0], s[1]));
            if (d > dist) {
                dist = d;
            }

        }
        return Math.sqrt(dist);
    } else {
        return Infinity;
    }
}

function renderSDF(glyph, fontSize, buffer, cutoff) {
    var fontScale = glyph.font.unitsPerEm / fontSize;

    var info = {
        width: 0,
        height: 0,
        data: null,

        glyphBearingX: 0,
        glyphWidth: 0,
        glyphBearingY: 0,
        glyphHeight: 0,
        glyphAdvance: Math.round(glyph.advanceWidth / fontScale),
    };

    var path = glyph.getPath(0, 0, fontSize).commands;

    var rings = [];
    var ring = [];

    var curve3 = new Curve3Div();
    curve3.approximation_scale = 2;

    var curve4 = new Curve4Div();
    curve4.approximation_scale = 2;

    for (var i = 0; i < path.length; i++) {
        var segment = path[i];
        if (segment.type == 'M') {
            if (ring.length) rings.push(ring);
            ring = [[ segment.x, segment.y ]];
        } else if (segment.type == 'L') {
            ring.push([ segment.x, segment.y ]);
        } else if (segment.type == 'Q') {
            var prev = ring.pop();
            curve3.init(prev[0], prev[1], segment.x1, segment.y1, segment.x, segment.y);
            ring = ring.concat(curve3.points);
        } else if (segment.type == 'C') {
            var prev = ring.pop();
            curve4.init(prev[0], prev[1], segment.x1, segment.y1, segment.x2, segment.y2, segment.x, segment.y);
            ring = ring.concat(curve4.points);
        } else if (segment.type == 'Z') {
            if (ring.length) {
                ring.push([ring[0][0], ring[0][1]]);
            }
        } else {
            throw segment;
        }
    }
    if (ring.length) rings.push(ring);

    if (!rings.length) {
        return info;
    }

    // Calculate the real glyph bbox.
    var xMin = Infinity, yMin = Infinity;
    var xMax = -Infinity, yMax = -Infinity;

    for (var j = 0; j < rings.length; j++) {
        var ring = rings[j];
        for (var i = 0; i < ring.length; i++) {
            var point = ring[i];
            if (point[0] > xMax) xMax = point[0];
            if (point[0] < xMin) xMin = point[0];
            if (point[1] > yMax) yMax = point[1];
            if (point[1] < yMin) yMin = point[1];
        }
    }

    xMin = Math.round(xMin);
    yMin = Math.round(yMin);
    xMax = Math.round(xMax);
    yMax = Math.round(yMax);

    // Offset so that glyph outlines are in the bounding box.
    for (var j = 0; j < rings.length; j++) {
        var ring = rings[j];
        for (var i = 0; i < ring.length; i++) {
            var point = ring[i];
            point[0] += -xMin + buffer;
            point[1] += -yMin + buffer;
        }
    }

    var width = 0;
    var height = 0;
    var data = null;

    if (xMax - xMin === 0 || yMax == yMin === 0) {
        return info;
    }

    info.glyphBearingX = xMin;
    info.glyphWidth = xMax - xMin;
    info.glyphBearingY = -yMin;
    info.glyphHeight = yMax - yMin;
    info.width = info.glyphWidth + 2 * buffer;
    info.height = info.glyphHeight + 2 * buffer;
    info.data = new Uint8ClampedArray(info.width * info.height);

    var tree = rbush(9);
    var offset = 0.5;
    var radius = 2 * buffer;

    for (var j = 0; j < rings.length; j++) {
        var ring = rings[j];
        for (var i = 1; i < ring.length; i++) {
            tree.insert(bbox(
                [ring[i-1][0], ring[i-1][1] ],
                [ring[i][0], ring[i][1]]
            ));
        }
    }

    for (var y = 0; y < info.height; y++) {
        for (var x = 0; x < info.width; x++) {
            var i = y * info.width + x;

            var p = pt(x + offset, y + offset);

            var d = minDistanceToLineSegment(tree, p, radius) * (256 / radius);

            // Invert if point is inside.
            var inside = polyContainsPoint(rings, { x: x + offset, y: y + offset });
            if (inside) {
                d = -d;
            }

            d += cutoff * 256;

            info.data[i] = 255 - d;
        }
    }

    return info;
}

module.exports = renderSDF;