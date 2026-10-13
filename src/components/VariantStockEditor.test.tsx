import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { serializeVariants, splitGroup } from "../lib/merch-variants";
import { VariantStockEditor } from "./VariantStockEditor";

const hidden = (container: HTMLElement) =>
  (container.querySelector('input[type="hidden"][name="variants"]') as HTMLInputElement).value;

describe("VariantStockEditor", () => {
  it("serializza nel formato taglia:quantità, ignorando le righe vuote e i due punti", () => {
    expect(
      serializeVariants([
        { label: "S", stock: "10" },
        { label: "M", stock: "" },
        { label: "  ", stock: "5" },
        { group: "Donna", label: "L:x", stock: " 3 " },
      ]),
    ).toBe("S:10\nM:\nDonna L x:3");
  });

  it("riconosce il prefisso Uomo/Donna", () => {
    expect(splitGroup("Uomo XL")).toEqual({ group: "Uomo", label: "XL" });
    expect(splitGroup("donna M")).toEqual({ group: "Donna", label: "M" });
    expect(splitGroup("Unica")).toEqual({ group: "", label: "Unica" });
  });

  it("parte dalle taglie abbigliamento e passa a uomo e donna", () => {
    const { container } = render(<VariantStockEditor name="variants" />);
    expect(hidden(container)).toBe("S:\nM:\nL:\nXL:\n2XL:\n3XL:");
    fireEvent.change(screen.getByLabelText("Scorta S"), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Uomo e donna" }));
    const lines = hidden(container).split("\n");
    expect(lines).toHaveLength(12);
    expect(lines).toContain("Uomo S:7");
    expect(lines).toContain("Donna S:");
    fireEvent.click(screen.getByRole("button", { name: "Per tutti" }));
    expect(hidden(container)).toBe("S:7\nM:\nL:\nXL:\n2XL:\n3XL:");
  });

  it("riapre in modalità uomo e donna quando le varianti hanno il prefisso", () => {
    const { container } = render(
      <VariantStockEditor
        name="variants"
        initial={[
          { label: "Uomo M", stock: 4 },
          { label: "Donna M", stock: null },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Uomo e donna" })).toHaveAttribute("aria-pressed", "true");
    expect(hidden(container)).toBe("Uomo M:4\nDonna M:");
  });
});
