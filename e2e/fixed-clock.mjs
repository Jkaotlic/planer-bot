// Смещает Date на последний понедельник 11:00 МСК: время идёт, но день недели постоянен.
// Сценарии ставят смены «в этот вторник» и «в эту неделю», а с настоящей датой половина
// из них падала бы по выходным — гейт уже кусался так: тест падал только по пятницам.
//
// Понедельник прошлый, а не далёкий фиксированный: `created_at` ставит сама SQLite по
// настоящим часам. Приложение, живущее в будущем, сочло бы свежий опрос старым на годы
// и закрыло бы его своим тиком. Отстать от SQLite на дни безопасно, обогнать — нет.
const RealDate = Date;
const DAY_MS = 86_400_000;
const realNow = RealDate.now();
const anchor = new RealDate(realNow);
anchor.setUTCHours(8, 0, 0, 0);
const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
let monday = anchor.getTime() - daysSinceMonday * DAY_MS;
if (monday > realNow) monday -= 7 * DAY_MS;
const offset = monday - realNow;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }
  static now() {
    return RealDate.now() + offset;
  }
};
