// Смещает Date в понедельник 2030-03-04, 11:00 МСК: время идёт, но дата постоянна.
// Сценарии ставят смены «в этот вторник» и «в эту неделю», а с настоящей датой половина
// из них падала бы по выходным — гейт уже кусался так: тест падал только по пятницам.
const RealDate = Date;
const offset = RealDate.UTC(2030, 2, 4, 8, 0, 0) - RealDate.now();
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }
  static now() {
    return RealDate.now() + offset;
  }
};
