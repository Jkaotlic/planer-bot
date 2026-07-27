import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TopBar } from "./TopBar";

describe("TopBar roster controls", () => {
  it("renders separate upload and download actions", () => {
    const html = renderToStaticMarkup(
      <TopBar
        weekLabel="27 июля — 2 августа"
        onPrevWeek={() => {}}
        onNextWeek={() => {}}
        onDistributeFairly={() => {}}
        onAddEntry={() => {}}
        onImportRoster={() => {}}
        onExportRoster={() => {}}
      />,
    );

    expect(html).toContain("Загрузить CSV");
    expect(html).toContain("Выгрузить CSV");
  });
});
