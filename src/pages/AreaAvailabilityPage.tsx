import { AvailabilityPage } from "./AvailabilityPage";
import { AreaAllocationReleasePanel } from "../components/AreaAllocationReleasePanel";

export function AreaAvailabilityPage() {
  return (
    <>
      <AvailabilityPage />
      <div className="page-container">
        <AreaAllocationReleasePanel />
      </div>
    </>
  );
}
