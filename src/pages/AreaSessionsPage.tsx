import { AreaAllocationReleasePanel } from "../components/AreaAllocationReleasePanel";
import { MultiDayAllocationPanel } from "../components/MultiDayAllocationPanel";
import { SessionsPage } from "./SessionsPage";

export function AreaSessionsPage() {
  return (
    <>
      <SessionsPage beforeCreate={<MultiDayAllocationPanel />} />
      <div className="page-container">
        <AreaAllocationReleasePanel />
      </div>
    </>
  );
}
