/** The customers in the demo billing data (see the README), for the presenter to quote on a call. */
const CUSTOMERS = [
  { number: "100245", postcode: "00150", scenario: "High bill from an estimated reading" },
  { number: "100318", postcode: "02100", scenario: "October bill paid twice" },
  { number: "100472", postcode: "33100", scenario: "Bill up with spot price and usage" },
  { number: "100533", postcode: "90100", scenario: "Payment extension" },
];

export function DemoCustomers({ labelledBy }: { labelledBy: string }) {
  return (
    <table aria-labelledby={labelledBy} className="mt-2.5 w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] text-white/50">
          <th scope="col" className="px-1 pb-1.5 font-normal">Customer</th>
          <th scope="col" className="px-1 pb-1.5 font-normal">Postcode</th>
          <th scope="col" className="px-1 pb-1.5 font-normal">Case</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
        {CUSTOMERS.map((customer) => (
          <tr key={customer.number}>
            <td className="px-1 py-2 font-mono text-white/90 tabular-nums">{customer.number}</td>
            <td className="px-1 py-2 font-mono text-white/90 tabular-nums">{customer.postcode}</td>
            <td className="px-1 py-2 text-white/55">{customer.scenario}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
