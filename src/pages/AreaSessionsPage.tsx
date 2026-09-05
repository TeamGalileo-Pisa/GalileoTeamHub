import { MultiDayAllocationPanel } from "../components/MultiDayAllocationPanel";
import { SessionsPage } from "./SessionsPage";

export function AreaSessionsPage() {
  return (
    <>
      <div className="page-container">
        <MultiDayAllocationPanel />
      </div>
      <SessionsPage />
    </>
  );
}
