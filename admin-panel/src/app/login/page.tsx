import { FlashMessage } from "@/components/flash-message";
import { redirectIfAuthenticated } from "@/lib/auth";
import { loginAction } from "@/app/login/actions";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: {
    status?: string;
    message?: string;
  };
};

export default function LoginPage({ searchParams }: LoginPageProps) {
  redirectIfAuthenticated();

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Poverka Admin</h1>
        <p className="muted">Internal access only</p>
        <FlashMessage status={searchParams?.status} message={searchParams?.message} />
        <form action={loginAction} className="form-grid">
          <label htmlFor="login">
            Login
            <input id="login" name="login" type="text" autoComplete="username" required />
          </label>
          <label htmlFor="password">
            Password
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </div>
    </div>
  );
}
