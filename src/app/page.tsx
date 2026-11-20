import { redirect } from "next/navigation";
import { DEFAULT_AUTHENTICATED_PATH } from "@/server/auth/constants";

/** A raiz apenas encaminha; o proxy e a DAL cuidam da autenticação. */
export default function HomePage() {
  redirect(DEFAULT_AUTHENTICATED_PATH);
}
