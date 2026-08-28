/** A New York State bill as /api/bills returns it (see api/bills.ts). */
export interface Bill {
  printNo: string;
  session: number;
  title: string;
  summary: string;
  chamber: "senate" | "assembly" | "";
  sponsor: string;
  status: string;
  committee: string;
  actionDate: string;
  published: string;
  signed: boolean;
  url: string;
}
