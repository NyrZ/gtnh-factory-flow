import { redirect } from "next/navigation";

/**
 * The community hub lives inside the planner now, as the sidebar's Setups
 * tab. Old links still land somewhere useful: /community?plan=x becomes the
 * editor's /?plan=x open-to-edit link, everything else goes home.
 */
export default async function CommunityRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const plan = typeof params.plan === "string" ? params.plan : undefined;
  redirect(plan ? `/?plan=${encodeURIComponent(plan)}` : "/");
}
