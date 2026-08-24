import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TopBar } from "./TopBar";

describe("TopBar roster controls", () => {
  const render = () =>
    renderToStaticMarkup(
      <TopBar
        weekLabel="27 июля — 2 августа"
        onPrevWeek={() => {}}
        onNextWeek={() => {}}
        onAddEntry={() => {}}
        onImportRoster={() => {}}
        onExportRoster={() => {}}
      />,
    );

  it("renders separate upload and download actions", () => {
    const html = render();
    expect(html).toContain("Загрузить CSV");
    expect(html).toContain("Выгрузить CSV");
  });

  it("carries no permanently disabled control", () => {
    // Здесь когда-то стояла кнопка без клиентского метода за ней: она рисовалась
    // серой навсегда и читалась как сломанное приложение.
    expect(render()).not.toContain("disabled");
  });
});
