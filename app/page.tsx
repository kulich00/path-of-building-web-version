"use client";

import { useMemo, useState } from "react";

type ClusterJewel = { name:string; base:string; passives:string[]; notables:string[] };
type MasteryDetail = { nodeId:string; effectId:string; name:string; stats:string[] };
type BuildSummary = { className:string; ascendancy:string; level:string; treeVersion:string; activeSkill:string; itemCount:number; skillGroups:number; allocatedNodes:number; nodeIds:string[]; clusterJewels:ClusterJewel[]; masteries:string[]; xmlLength:number };
const emptySummary: BuildSummary = { className:"—",ascendancy:"—",level:"—",treeVersion:"—",activeSkill:"—",itemCount:0,skillGroups:0,allocatedNodes:0,nodeIds:[],clusterJewels:[],masteries:[],xmlLength:0 };

function readFirstAttribute(document:XMLDocument, selectors:string[], names:string[]) {
  for (const selector of selectors) { const element=document.querySelector(selector); if (!element) continue; for (const name of names) { const value=element.getAttribute(name); if (value) return value; } }
  return "—";
}

function directChildren(element:Element|null, tagName:string) {
  if (!element) return [];
  return Array.from(element.children).filter((child)=>child.tagName===tagName);
}

function isEnabled(element:Element) {
  return element.getAttribute("enabled")!=="false";
}

function isSupportGem(gem:Element) {
  const identity=[gem.getAttribute("skillId"),gem.getAttribute("gemId")].filter(Boolean).join(" ");
  return /(?:^|[\/_])Support(?:Gem)?/i.test(identity)||gem.getAttribute("support")==="true";
}

function findMainSkill(document:XMLDocument) {
  const skills=document.querySelector("Skills");
  if (!skills) return "—";

  const skillSets=directChildren(skills,"SkillSet");
  const activeSkillSetId=skills.getAttribute("activeSkillSet");
  const activeSkillSet=skillSets.find((set)=>set.getAttribute("id")===activeSkillSetId)
    ??skillSets.find((set)=>set.getAttribute("activeSkillSet")==="true")
    ??skillSets[0]
    ??skills;

  const skillGroups=directChildren(activeSkillSet,"Skill");
  const mainSocketGroup=Number.parseInt(document.querySelector("Build")?.getAttribute("mainSocketGroup")??"",10);
  const mainGroup=(Number.isFinite(mainSocketGroup)&&mainSocketGroup>0?skillGroups[mainSocketGroup-1]:undefined)
    ??skillGroups.find(isEnabled)
    ??skillGroups[0];
  if (!mainGroup) return "—";

  const gems=directChildren(mainGroup,"Gem").filter(isEnabled);
  const activeGems=gems.filter((gem)=>!isSupportGem(gem));
  const mainActiveSkill=Number.parseInt(mainGroup.getAttribute("mainActiveSkill")??"",10);
  const selected=(Number.isFinite(mainActiveSkill)&&mainActiveSkill>0?activeGems[mainActiveSkill-1]:undefined)
    ??activeGems[0]
    ??gems[0];

  return selected?.getAttribute("nameSpec")??selected?.getAttribute("name")??selected?.getAttribute("skillId")??"—";
}

function getLuaNodeBlocks(lua:string,id:string) {
  return Array.from(lua.matchAll(new RegExp(`^ {8}\\[${id}\\]\\s*=\\s*\\{`,`gm`))).map((match)=>{
    const start=match.index??0;
    const rest=lua.slice(start+match[0].length);
    const next=rest.search(/^ {8}\[\d+\]\s*=\s*\{/m);
    return lua.slice(start,next<0?lua.length:start+match[0].length+next);
  });
}

function extractNodeDetails(lua:string, ids:string[]) {
  return Object.fromEntries(ids.map((id)=>{
    const block=getLuaNodeBlocks(lua,id).find((candidate)=>/\["name"\]\s*=/.test(candidate));
    if (!block) return [id,`Cluster / jewel passive`];
    const name=block.match(/\["name"\]\s*=\s*"([^"]+)"/)?.[1];
    const stat=block.match(/\["stats"\]\s*=\s*\{\s*"([^"]+)"/)?.[1]; const ascendancy=block.match(/\["ascendancyName"\]\s*=\s*"([^"]+)"/)?.[1];
    const label=ascendancy&&name?`${ascendancy} · ${name}`:name;
    return [id,label?(stat?`${label} — ${stat}`:label):`Node #${id}`];
  }));
}

function extractKeystoneIds(lua:string, ids:string[]) {
  return ids.filter((id)=>getLuaNodeBlocks(lua,id).some((block)=>/\["name"\]\s*=/.test(block)&&/\["isKeystone"\]\s*=\s*true/.test(block)));
}

function extractMasteryDetails(lua:string,selections:string[]) {
  return Object.fromEntries(selections.flatMap((selection)=>{
    const ids=selection.match(/\d+/g); if (!ids||ids.length<2) return [];
    for (const [nodeId,effectId] of [[ids[0],ids[1]],[ids[1],ids[0]]]) {
      const block=getLuaNodeBlocks(lua,nodeId).find((candidate)=>/\["isMastery"\]\s*=\s*true/.test(candidate));
      if (!block) continue;
      const effectStart=block.search(new RegExp(`\\["effect"\\]\\s*=\\s*${effectId}\\b`));
      if (effectStart<0) continue;
      const effectBlock=block.slice(effectStart,effectStart+1800);
      const statsBody=effectBlock.match(/\["stats"\]\s*=\s*\{([\s\S]*?)\n\s*\}/)?.[1]??"";
      const stats=Array.from(statsBody.matchAll(/"((?:\\.|[^"])*)"/g)).map((match)=>match[1].replace(/\\n/g," "));
      const name=block.match(/\["name"\]\s*=\s*"([^"]+)"/)?.[1]??"Mastery";
      return [[selection,{nodeId,effectId,name,stats} satisfies MasteryDetail]];
    }
    return [];
  }));
}

function parseClusterJewels(document:XMLDocument):ClusterJewel[] {
  return Array.from(document.querySelectorAll("Items Item")).flatMap((item)=>{
    const lines=(item.textContent??"").split(/\r?\n/).map((line)=>line.trim()).filter(Boolean);
    const baseIndex=lines.findIndex((line)=>/Cluster Jewel/i.test(line));
    if (baseIndex<0) return [];
    const base=lines[baseIndex]; const name=lines.slice(0,baseIndex).reverse().find((line)=>!/^Rarity:/i.test(line))??base;
    const passives=lines.filter((line)=>/^\d*\s*Added (Small )?Passive Skill/i.test(line));
    const notables=lines.filter((line)=>/^\d*\s*Added Passive Skill is/i.test(line)).map((line)=>line.replace(/^\d*\s*Added Passive Skill is\s*/i,""));
    return [{name,base,passives,notables}];
  });
}

function parseMasteries(document:XMLDocument):string[] {
  const fromElements=Array.from(document.querySelectorAll("Mastery, MasteryEffect, Tree Mastery")).map((entry)=>entry.getAttribute("name")??entry.getAttribute("effect")??entry.textContent??"").map((value)=>value.trim()).filter(Boolean);
  const spec=document.querySelector("Tree Spec, Tree > Spec, Spec");
  const fromAttribute=(spec?.getAttribute("masteryEffects")??"").split(",").map((value)=>value.trim()).filter(Boolean).map((value)=>`Mastery effect ${value}`);
  return [...new Set([...fromElements,...fromAttribute])];
}

function parseBuild(xml:string): BuildSummary {
  const document=new DOMParser().parseFromString(xml,"application/xml");
  if (document.querySelector("parsererror")) throw new Error("После распаковки получен некорректный XML.");
  const root=document.documentElement;
  if (!/PathOfBuilding|PoB/i.test(root.tagName+(root.getAttribute("program")??""))) throw new Error("Это XML-файл, но он не похож на экспорт Path of Building.");
  const spec=document.querySelector("Tree Spec, Tree > Spec, Spec");
  const nodeIds=(spec?.getAttribute("nodes")??"").split(",").map((node)=>node.trim()).filter(Boolean);
  return {
    className:readFirstAttribute(document,["Build","PlayerStat"],["className","class"]),
    ascendancy:readFirstAttribute(document,["Build"],["ascendClassName","ascendancyName"]),
    level:readFirstAttribute(document,["Build"],["level"]),
    treeVersion:spec?.getAttribute("treeVersion")??spec?.getAttribute("version")??"—",
    activeSkill:findMainSkill(document),
    itemCount:document.querySelectorAll("Items Item").length,
    skillGroups:document.querySelectorAll("Skills Skill").length,
    allocatedNodes:nodeIds.length,
    nodeIds,
    clusterJewels:parseClusterJewels(document),
    masteries:parseMasteries(document),
    xmlLength:xml.length,
  };
}

async function decodePob(value:string) {
  const input=value.trim(); if (!input) throw new Error("Вставьте PoB-код."); if (input.startsWith("<")) return input;
  const normalized=input.replace(/-/g,"+").replace(/_/g,"/"); const padded=normalized.padEnd(Math.ceil(normalized.length/4)*4,"=");
  let binary:string; try { binary=atob(padded); } catch { throw new Error("Код не удалось декодировать как Base64URL."); }
  if (!("DecompressionStream" in window)) throw new Error("Этот браузер не поддерживает распаковку PoB-кода.");
  const compressed=Uint8Array.from(binary,(character)=>character.charCodeAt(0));
  try { const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate")); return await new Response(stream).text(); }
  catch { throw new Error("Код распознан, но не распакован. Проверьте, что это полный экспорт PoB."); }
}

export default function Home() {
  const [code,setCode]=useState(""); const [summary,setSummary]=useState<BuildSummary>(emptySummary); const [status,setStatus]=useState<"idle"|"loading"|"success"|"error">("idle"); const [message,setMessage]=useState("Ожидается импорт билда"); const [section,setSection]=useState<"import"|"tree">("import"); const [nodeSearch,setNodeSearch]=useState(""); const [nodeDetails,setNodeDetails]=useState<Record<string,string>>({}); const [keystoneIds,setKeystoneIds]=useState<string[]>([]); const [masteryDetails,setMasteryDetails]=useState<Record<string,MasteryDetail>>({}); const [treeDataStatus,setTreeDataStatus]=useState<"idle"|"loading"|"ready"|"error">("idle");
  const buildTitle=useMemo(()=>status!=="success"?"Новый билд":[summary.className,summary.ascendancy].filter((part)=>part!=="—").join(" · ")||"Импортированный билд",[status,summary]);
  const visibleNodeIds=useMemo(()=>{const query=nodeSearch.trim().toLowerCase();return summary.nodeIds.filter((node)=>!query||node.includes(query)||(nodeDetails[node]??"").toLowerCase().includes(query));},[summary.nodeIds,nodeSearch,nodeDetails]);
  const allAscendancyNodes=useMemo(()=>summary.nodeIds.filter((node)=>/^[^—]+ · [^—]+(?: —|$)/.test(nodeDetails[node]??"")),[summary.nodeIds,nodeDetails]);
  const ascendancyNodes=useMemo(()=>summary.nodeIds.filter((node)=>(nodeDetails[node]??"").startsWith(`${summary.ascendancy} · `)),[summary.nodeIds,nodeDetails,summary.ascendancy]);
  const keystones=useMemo(()=>summary.nodeIds.filter((node)=>keystoneIds.includes(node)),[summary.nodeIds,keystoneIds]);
  const masteryNodeIds=useMemo(()=>new Set(Object.values(masteryDetails).map((mastery)=>mastery.nodeId)),[masteryDetails]);
  const regularNodeIds=useMemo(()=>visibleNodeIds.filter((node)=>!allAscendancyNodes.includes(node)&&!keystones.includes(node)&&!masteryNodeIds.has(node)),[visibleNodeIds,allAscendancyNodes,keystones,masteryNodeIds]);
  async function importBuild(){ setStatus("loading");setMessage("Декодируем и проверяем билд…");try{const xml=await decodePob(code);setSummary(parseBuild(xml));setNodeDetails({});setKeystoneIds([]);setMasteryDetails({});setTreeDataStatus("idle");setStatus("success");setMessage("Билд успешно импортирован");}catch(error){setSummary(emptySummary);setStatus("error");setMessage(error instanceof Error?error.message:"Не удалось импортировать билд.");}}
  function clear(){setCode("");setSummary(emptySummary);setNodeDetails({});setKeystoneIds([]);setMasteryDetails({});setTreeDataStatus("idle");setStatus("idle");setMessage("Ожидается импорт билда");}
  async function openTree(){setSection("tree");if(!summary.nodeIds.length||treeDataStatus!=="idle")return;setTreeDataStatus("loading");try{const response=await fetch(`https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding/refs/heads/dev/src/TreeData/${summary.treeVersion}/tree.lua`);if(!response.ok)throw new Error();const lua=await response.text();setNodeDetails(extractNodeDetails(lua,summary.nodeIds));setKeystoneIds(extractKeystoneIds(lua,summary.nodeIds));setMasteryDetails(extractMasteryDetails(lua,summary.masteries));setTreeDataStatus("ready");}catch{setTreeDataStatus("error");}}
  const treeContent=summary.nodeIds.length ? <div className="tree-layout">
    <section className="panel tree-panel"><div className="panel-title"><span>ALLOCATED NODES</span><small>PoE {summary.treeVersion}</small></div><div className="tree-map" aria-label="Выбранные узлы пассивного дерева"><div className="tree-core">{summary.className}<small>{summary.ascendancy}</small></div><div className="tree-orbit orbit-one"/><div className="tree-orbit orbit-two"/>{summary.nodeIds.slice(0,24).map((node,index)=>{const angle=(index/Math.min(summary.nodeIds.length,24))*Math.PI*2-Math.PI/2;const radius=index<8?31:index<16?42:48;return <span key={node} className="tree-node" style={{left:`${50+Math.cos(angle)*radius}%`,top:`${50+Math.sin(angle)*radius}%`}} title={nodeDetails[node]??`Node ${node}`}>{node}</span>;})}</div><p className="tree-caption">Схема показывает выделенные узлы из импорта. Список справа получает названия и эффекты напрямую из TreeData PoB.</p></section>
    <section className="node-panel"><div className="tree-overview"><article><span>Allocated</span><b>{summary.allocatedNodes}</b></article><article><span>Keystones</span><b>{keystones.length}</b></article><article><span>Masteries</span><b>{summary.masteries.length}</b></article><article><span>Ascendancy</span><b>{ascendancyNodes.length}</b></article><article><span>Clusters</span><b>{summary.clusterJewels.length}</b></article></div><div className="panel tree-section"><div className="panel-title"><span>SEARCH NODES</span><small>{treeDataStatus==="loading"?"loading…":`${visibleNodeIds.length} found`}</small></div><label className="node-search" htmlFor="node-search">Имя, эффект или ID<input id="node-search" value={nodeSearch} onChange={(event)=>setNodeSearch(event.target.value)} placeholder="Mind over Matter"/></label></div>{keystones.length>0&&<div className="panel tree-section accent"><div className="panel-title"><span>KEYSTONES</span><small>{keystones.length}</small></div><div className="node-cards">{keystones.map((node)=><article key={node}><b>{nodeDetails[node]?.split(" — ")[0]}</b><p>{nodeDetails[node]?.split(" — ")[1]}</p></article>)}</div></div>}{ascendancyNodes.length>0&&<div className="panel tree-section"><div className="panel-title"><span>ASCENDANCY</span><small>{summary.ascendancy}</small></div><div className="node-cards">{ascendancyNodes.map((node)=><article key={node}><b>{nodeDetails[node]?.split(" · ")[1]?.split(" — ")[0]}</b><p>{nodeDetails[node]?.split(" — ")[1]}</p></article>)}</div></div>}{summary.masteries.length>0&&<div className="panel tree-section mastery-section"><div className="panel-title"><span>SELECTED MASTERIES</span><small>{Object.keys(masteryDetails).length} / {summary.masteries.length}</small></div><div className="node-cards">{summary.masteries.map((selection)=>{const mastery=masteryDetails[selection];return <article key={selection} className={mastery?"resolved":"unresolved"}><b>{mastery?.name??"Неизвестный mastery"}</b>{mastery?.stats.map((stat)=><p key={stat}>{stat}</p>)??<p>Эффект {selection.replace("Mastery effect ","")} не найден в TreeData этой версии.</p>}</article>})}</div></div>}<div className="panel tree-section"><div className="panel-title"><span>PASSIVE NODES</span><small>{regularNodeIds.length}</small></div><div className="node-cards compact">{regularNodeIds.map((node)=><article key={node}><b>{nodeDetails[node]?.split(" — ")[0]??`Passive #${node}`}</b><p>{nodeDetails[node]?.split(" — ")[1]??""}</p></article>)}</div></div>{summary.clusterJewels.length>0&&<div className="panel tree-section"><div className="panel-title"><span>CLUSTER JEWELS</span><small>{summary.clusterJewels.length}</small></div><div className="cluster-grid">{summary.clusterJewels.map((jewel,index)=><article key={`${jewel.name}-${index}`} className="cluster-card"><b>{jewel.name}</b><small>{jewel.base}</small>{jewel.notables.length>0&&<div className="notable-list"><strong>Large nodes</strong>{jewel.notables.map((notable)=><p key={notable}>{notable}</p>)}</div>}</article>)}</div></div>}</section>
  </div> : <section className="panel empty-tree"><span>◆</span><h2>Сначала импортируй билд</h2><p>Вкладка Tree прочитает список выделенных узлов и версию дерева прямо из PoB‑экспорта.</p><button className="primary" onClick={()=>setSection("import")}>Перейти к импорту</button></section>;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">P</span><strong>Path of Building</strong><small>WEB · POE 1</small></div><div className="patch"><span className="online-dot"/> PoE 3.29 · PoB 2.67.2</div></header>
    <div className="workspace"><aside className="sidebar"><div className="build-name"><span>BUILD</span><strong>{buildTitle}</strong></div><nav aria-label="Разделы билда"><button className={`nav-item ${section==="import"?"active":""}`} onClick={()=>setSection("import")}><span>↧</span> Import / Export Build</button><button className={`nav-item ${section==="tree"?"active":""}`} onClick={openTree}><span>◆</span> Tree <em>beta</em></button><button className="nav-item" disabled><span>✦</span> Skills <em>скоро</em></button><button className="nav-item" disabled><span>▣</span> Items <em>скоро</em></button><button className="nav-item" disabled><span>∑</span> Calcs <em>скоро</em></button></nav><div className="sidebar-stats"><p><span>Level</span><b>{summary.level}</b></p><p><span>Allocated nodes</span><b>{summary.allocatedNodes||"—"}</b></p><p><span>Items</span><b>{summary.itemCount||"—"}</b></p><p><span>Skill groups</span><b>{summary.skillGroups||"—"}</b></p></div></aside>
    <section className="content">{section==="import" ? <><div className="content-heading"><div><p className="eyebrow">IMPORT / EXPORT BUILD</p><h1>Импорт билда Path of Building</h1></div><span className={`status-pill ${status}`}>{status==="success"?"✓":status==="error"?"!":"●"} {message}</span></div><div className="import-grid"><section className="panel import-panel"><div className="panel-title"><span>BUILD CODE</span><small>Base64URL + zlib + XML</small></div><label htmlFor="pob-code">Вставьте код из PoB: Import/Export Build → Generate</label><textarea id="pob-code" value={code} onChange={(event)=>setCode(event.target.value)} placeholder="eNrt..." spellCheck={false}/><div className="actions"><button className="primary" onClick={importBuild} disabled={status==="loading"}>Импортировать билд</button><button className="secondary" onClick={clear}>Очистить</button></div></section><section className="panel summary-panel"><div className="panel-title"><span>BUILD SUMMARY</span><small>данные из XML</small></div><dl><div><dt>Class</dt><dd>{summary.className}</dd></div><div><dt>Ascendancy</dt><dd>{summary.ascendancy}</dd></div><div><dt>Level</dt><dd>{summary.level}</dd></div><div><dt>Main skill</dt><dd>{summary.activeSkill}</dd></div><div><dt>Tree version</dt><dd>{summary.treeVersion}</dd></div><div><dt>Decoded XML</dt><dd>{summary.xmlLength?`${summary.xmlLength.toLocaleString("ru-RU")} chars`:"—"}</dd></div></dl></section></div><section className="pipeline" aria-label="Этапы импорта"><div className="pipeline-step done"><b>01</b><span>PoB code<small>Base64URL</small></span></div><i>→</i><div className="pipeline-step done"><b>02</b><span>Decompress<small>zlib / deflate</small></span></div><i>→</i><div className={`pipeline-step ${status==="success"?"done":""}`}><b>03</b><span>Build XML<small>validated</small></span></div><i>→</i><div className="pipeline-step"><b>04</b><span>Lua engine<small>следующий этап</small></span></div></section></> : <><div className="content-heading"><div><p className="eyebrow">PASSIVE TREE · IMPORTED BUILD</p><h1>Пассивное дерево</h1></div><span className={`status-pill ${status}`}>{summary.allocatedNodes?`${summary.allocatedNodes} nodes`:"Нет данных дерева"}</span></div>{treeContent}</>}<p className="footnote">Совместимый веб-интерфейс для Path of Building Community. Не связан с Grinding Gear Games.</p></section></div>
  </main>;
}
