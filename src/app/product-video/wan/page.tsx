import { WanStudio } from "@/components/wan/WanStudio";
import "./wan.css";
export default async function WanPage({searchParams}:{searchParams:Promise<{storage?:string}>}) {
  const query=await searchParams;return <WanStudio initialStorage={query.storage==="server"?"server":"directory"}/>;
}
