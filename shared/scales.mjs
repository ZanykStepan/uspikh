export class ScaleStrategy {
  constructor(key) {
    this.key = key;
  }

  convert() {
    throw new Error(`Шкала «${this.key}» не реалізує convert()`);
  }
}

export class FiveScale extends ScaleStrategy {
  constructor() {
    super("five");
  }

  convert(score) {
    return score >= 90 ? 5 : score >= 75 ? 4 : score >= 50 ? 3 : score >= 35 ? 2 : 1;
  }
}

export class TwelveScale extends ScaleStrategy {
  constructor() {
    super("twelve");
  }

  convert(score) {
    return Math.round((score * 12) / 100);
  }
}

export class EctsScale extends ScaleStrategy {
  constructor() {
    super("ects");
  }

  convert(score) {
    return score >= 90 ? "A" : score >= 82 ? "B" : score >= 75 ? "C" : score >= 68 ? "D" : score >= 50 ? "E" : score >= 35 ? "FX" : "F";
  }
}

export class GradeScaleConverter {
  constructor(strategies) {
    this.strategies = strategies;
  }

  convert(score) {
    if (score == null) return null;
    const bounded = Math.max(0, Math.min(100, score));
    return Object.fromEntries(this.strategies.map((strategy) => [strategy.key, strategy.convert(bounded)]));
  }
}

const defaultConverter = new GradeScaleConverter([new FiveScale(), new TwelveScale(), new EctsScale()]);

export const convertSemesterScore = (score) => defaultConverter.convert(score);
