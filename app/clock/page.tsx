import { redirect } from "next/navigation";

// The clock is the home page now; old links land there.
export default function ClockPage() {
  redirect("/");
}
