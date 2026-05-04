import { redirect } from 'next/navigation';

export default function Home(): never {
  redirect('/en-US/pricing');
  // unreachable
  throw new Error('redirect threw');
}
