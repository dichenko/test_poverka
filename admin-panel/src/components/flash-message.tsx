type FlashMessageProps = {
  status?: string;
  message?: string;
};

export function FlashMessage({ status, message }: FlashMessageProps) {
  if (!message) {
    return null;
  }

  const className = status === "success" ? "flash success" : "flash error";
  return <p className={className}>{message}</p>;
}

