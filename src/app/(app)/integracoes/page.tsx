import { redirect } from "next/navigation";

/** A antiga tela de Integrações agora faz parte da Central de dados. */
export default function IntegrationsRedirect() {
  redirect("/dados");
}
