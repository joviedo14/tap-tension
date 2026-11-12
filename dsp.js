/* Tap Tension signal processing: find the string bed's ping frequency and convert it to tension. */
(function (root) {
  "use strict";

  var LB_PER_N = 1 / 4.44822;
  var M2_PER_IN2 = 0.00064516;
  // Fundamental mode of a circular membrane with equal tension both ways:
  // f = 2.405/(2*pi*R) * sqrt(T / (2*mu))  ->  T = (8*pi/2.405^2) * mu * A * f^2
  var MEMBRANE_K = (8 * Math.PI) / (2.405 * 2.405);

  var MATERIALS = {
    synthetic: { label: "Synthetic gut", density: 1.14 },
    multi: { label: "Multifilament", density: 1.15 },
    poly: { label: "Poly / co-poly", density: 1.38 },
    gut: { label: "Natural gut", density: 1.3 },
    kevlar: { label: "Kevlar / aramid", density: 1.44 },
    // Specific strings: picking one also fills in its gauge
    smashOrange: { label: "Kirschbaum Super Smash Orange 1.23", density: 1.38, gauge: 1.23 }
  };

  // Linear density in kg/m from material density (g/cm^3) and gauge (mm)
  function linearDensity(materialKey, gaugeMm) {
    var m = MATERIALS[materialKey] || MATERIALS.synthetic;
    var r = gaugeMm / 2000;
    return m.density * 1000 * Math.PI * r * r;
  }

  function effectiveMu(mains, crosses) {
    return (linearDensity(mains.type, mains.gauge) + linearDensity(crosses.type, crosses.gauge)) / 2;
  }

  function tensionLb(hz, setup) {
    var A = setup.headIn2 * M2_PER_IN2;
    var tN = MEMBRANE_K * setup.mu * A * hz * hz * (setup.factor || 1);
    return tN * LB_PER_N;
  }

  function frequencyFor(lb, setup) {
    var A = setup.headIn2 * M2_PER_IN2;
    return Math.sqrt((lb / LB_PER_N) / (MEMBRANE_K * setup.mu * A * (setup.factor || 1)));
  }

  function fft(re, im) {
    var n = re.length, i, j, k, len, tr, ti;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        tr = re[i]; re[i] = re[j]; re[j] = tr;
        ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (k = 0; k < half; k++) {
          var a = i + k, b = a + half;
          var xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // samples: Float32Array starting just after the tap. Returns {hz, snr} or null.
  function analyze(samples, sampleRate, fmin, fmax) {
    var len = samples.length;
    var N = 1;
    while (N < len * 4) N <<= 1;
    if (N > 65536) N = 65536;
    var use = Math.min(len, N);
    var re = new Float64Array(N), im = new Float64Array(N);
    var mean = 0, i;
    for (i = 0; i < use; i++) mean += samples[i];
    mean /= use;
    for (i = 0; i < use; i++) {
      var w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (use - 1));
      re[i] = (samples[i] - mean) * w;
    }
    fft(re, im);
    var kmin = Math.max(2, Math.ceil((fmin * N) / sampleRate));
    var kmax = Math.min(N / 2 - 2, Math.floor((fmax * N) / sampleRate));
    if (kmax <= kmin + 4) return null;
    var mag = new Float64Array(kmax + 2);
    for (i = kmin - 1; i <= kmax + 1; i++) mag[i] = Math.hypot(re[i], im[i]);

    var best = kmin;
    for (i = kmin; i <= kmax; i++) if (mag[i] > mag[best]) best = i;
    var peak = mag[best];
    if (!(peak > 0)) return null;

    // The fundamental can be weaker than an overtone. Prefer a strong lower
    // peak sitting at an overtone ratio below the strongest one.
    var chosen = best;
    for (i = kmin + 1; i < best; i++) {
      if (mag[i] >= peak * 0.35 && mag[i] > mag[i - 1] && mag[i] >= mag[i + 1]) {
        var r = best / i;
        if ((r > 1.4 && r < 1.8) || (r > 1.9 && r < 2.1)) { chosen = i; break; }
      }
    }

    var vals = Array.prototype.slice.call(mag, kmin, kmax + 1).sort(function (a, b) { return a - b; });
    var median = vals[Math.floor(vals.length / 2)] || 1e-12;
    var snr = mag[chosen] / median;

    var a = Math.log(mag[chosen - 1] + 1e-12), b = Math.log(mag[chosen] + 1e-12), c = Math.log(mag[chosen + 1] + 1e-12);
    var den = a - 2 * b + c;
    var p = den !== 0 ? (0.5 * (a - c)) / den : 0;
    if (p > 0.5 || p < -0.5) p = 0;
    return { hz: ((chosen + p) * sampleRate) / N, snr: snr };
  }

  function median(arr) {
    if (!arr.length) return NaN;
    var s = arr.slice().sort(function (x, y) { return x - y; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  var api = {
    MATERIALS: MATERIALS,
    linearDensity: linearDensity,
    effectiveMu: effectiveMu,
    tensionLb: tensionLb,
    frequencyFor: frequencyFor,
    analyze: analyze,
    median: median
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TapDSP = api;
})(this);
