"""Build a self-contained HTML research report with Python/Matplotlib figures."""
from pathlib import Path
from collections import Counter, defaultdict
import base64, html, json, re
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.colors import LinearSegmentedColormap

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'reports/day90'
D=json.loads((OUT/'data.json').read_text()); DAY=86400000; R=2500/3400
font='/System/Library/Fonts/STHeiti Light.ttc'
fm.fontManager.addfont(font)
plt.rcParams.update({'font.family':fm.FontProperties(fname=font).get_name(),'font.size':10,
 'axes.unicode_minus':False,'axes.spines.top':False,'axes.spines.right':False,
 'axes.edgecolor':'#d7d6cc','axes.labelcolor':'#4d5a54','text.color':'#233e35',
 'xtick.color':'#607169','ytick.color':'#607169','figure.facecolor':'#fbfaf6','axes.facecolor':'#fbfaf6',
 'grid.color':'#e5e5dc','grid.linewidth':.7,'savefig.facecolor':'#fbfaf6'})
C={'green':'#246854','red':'#ba5437','gold':'#b99548','blue':'#587f96','dark':'#263e36','pale':'#a6b9a7'}
M=D['metrics']; x=np.array([m['x'] for m in M]); final=M[-1]; cutoff=final['x'];
roster={a['id']:a for a in D['final']['agents']}; initial={a['id']:a for a in D['initial']['agents']}
figures={}
def save(name, fig):
 fig.tight_layout(pad=1.8)
 path=OUT/(name+'.png');fig.savefig(path,dpi=170,bbox_inches='tight');plt.close(fig)
 figures[name]=base64.b64encode(path.read_bytes()).decode()
def grid(ax):ax.grid(axis='y',zorder=0);ax.set_axisbelow(True)
def xlabel(ax):ax.set_xlabel('界面显示日（Day）');ax.set_xlim(1,91)
def marker(ax,at,label,color):
 ax.axvline(at,color=color,ls='--',lw=1,alpha=.6)
 ax.text(at+.5,.96,label,color=color,transform=ax.get_xaxis_transform(),va='top',fontsize=9)

# 1. Population, with exact death timestamps.
fig,ax=plt.subplots(figsize=(11.3,4.2));p=D['population'];xp=[p['x'] for p in p]
for key,label,c in [('locals','本地居民',C['green']),('army','王军',C['red']),('messenger','王室使者',C['gold'])]:
 ax.step(xp,[p[key] for p in p],where='post',label=label,color=c,lw=2.6)
ax.scatter([d['time']/DAY+1 for d in D['deaths']],[0]*32,marker='|',s=70,color=C['red'],alpha=.6)
ax.set_ylabel('存活并在场人数');ax.set_ylim(-1,36);xlabel(ax);grid(ax)
marker(ax,31,'首次收获',C['gold']);marker(ax,61,'减产收获',C['gold']);marker(ax,87,'王军入境',C['red'])
ax.legend(loc='center left',frameon=False);save('population',fig)

# 2. Physical stocks, distinguishing harvested field grain and corpse-held grain.
fig,axes=plt.subplots(2,1,figsize=(11.3,6.6),sharex=True,gridspec_kw={'height_ratios':[2,1]})
ax=axes[0];keys=['house','keep','public','carriedLocal','fields'];labels=['家庭储藏','庄园粮仓','公共粮箱','本地活人随身','田间成熟待搬']
ax.stackplot(x,*[[m[k] for m in M] for k in keys],labels=labels,colors=[C['green'],C['red'],C['gold'],C['blue'],C['pale']],alpha=.87)
ax.set_ylabel('谷物库存 kg');grid(ax);ax.legend(ncol=3,loc='upper right',frameon=False,fontsize=9)
ax=axes[1];ax.plot(x,[m['keep'] for m in M],color=C['red'],lw=2,label='庄园口粮仓')
ax.plot(x,[m['public'] for m in M],color=C['gold'],lw=2,label='公共粮箱');ax.set_ylabel('两处公共供应 kg');grid(ax);xlabel(ax);ax.legend(frameon=False,ncol=2)
save('grain',fig)

# 3. Crown taxes with event-accurate daily state.
fig,ax=plt.subplots(figsize=(11.3,4.2));ax.step(x,[m['paid'] for m in M],where='post',label='累计实缴',color=C['green'],lw=2.2)
ax.step(x,[m['arrears'] for m in M],where='post',label='未缴欠款',color=C['red'],lw=2.2)
ax.axhline(450*R,color=C['gold'],ls=':',label=f'每期王税 {450*R:.2f} kg')
marker(ax,36,'首期到期',C['gold']);marker(ax,66,'第二期到期',C['gold']);marker(ax,87,'逾期出兵',C['red'])
ax.set_ylabel('谷物 kg');xlabel(ax);grid(ax);ax.legend(frameon=False,loc='center left');save('tax',fig)

# 4. Daily health heatmap for all 32 local residents.
mat=np.zeros((32,90))
for day in range(1,91):
 row=next((h for h in reversed(D['health']) if h['x']<=day),D['health'][0])
 if day==90:row=D['health'][-1]
 for i in range(32):
  a=row['agents'].get(str(i+1),{});mat[i,day-1]=0 if a.get('dead') else a.get('hp',100)
cmap=LinearSegmentedColormap.from_list('health',['#273c35','#bb634a','#ddc891','#c1d1b8','#3a8065'])
fig,ax=plt.subplots(figsize=(11.3,8.1));im=ax.imshow(mat,aspect='auto',vmin=0,vmax=100,cmap=cmap,extent=(.5,90.5,32.5,.5),interpolation='nearest')
ax.set_yticks(range(1,33));ax.set_yticklabels([f'#{i} {roster[i]["name"]}' for i in range(1,33)],fontsize=8)
ax.set_xticks([1,10,20,30,40,50,60,70,80,90]);ax.set_xlabel('各日开始时的生命值；第90列为截止快照')
fig.colorbar(im,ax=ax,pad=.015,shrink=.6,label='生命值 / 100（死亡记0）')
for d in D['deaths']:ax.scatter(d['time']/DAY+1,d['id'],s=12,marker='x',color='#f9f2de',linewidths=.8)
save('health',fig)

# 5. Decision cadence and completed event families. Counts are not durations.
days=np.arange(1,91);daily=D['daily'];get=lambda key:np.array([daily.get(str(i),{}).get(key,0) for i in days])
fig,axes=plt.subplots(2,1,figsize=(11.3,6.2),sharex=True)
axes[0].bar(days,get('think_finished'),color=C['pale'],width=.85,label='完成的思考请求')
axes[0].bar(days,get('think_failed'),color=C['red'],width=.85,label='其中：日志标记失败')
axes[0].set_ylabel('次数 / 显示日');axes[0].legend(frameon=False,ncol=2);grid(axes[0])
for key,label,c in [('speech','实际发言',C['blue']),('work','完成劳动动作',C['green']),('attacks','完成攻击',C['red'])]:
 axes[1].plot(days,get(key),label=label,color=c,lw=1.8)
axes[1].set_ylabel('事件次数 / 显示日');xlabel(axes[1]);grid(axes[1]);axes[1].legend(frameon=False,ncol=3)
save('decisions',fig)

# 6. Auditory contact, not inferred sentiment or friendship.
groups=['庄园','村长','麦田家','磨坊家','榆树家','河湾家','石桥家','牧钟家','王使','王军']
def group(a):
 if a in [1,2,3,4,5,6,32]:return 0
 if a==7:return 1
 if 8<=a<=31:return 2+(a-8)//4
 if a==33:return 8
 return 9
net=np.zeros((10,10),dtype=int)
for e in D['speeches']:
 for listener in e['listeners'] or []:net[group(e['actor']),group(listener)]+=1
fig,ax=plt.subplots(figsize=(10,6.8));im=ax.imshow(np.log1p(net),cmap='YlGnBu',aspect='auto')
ax.set_xticks(range(10));ax.set_xticklabels(groups);ax.set_yticks(range(10));ax.set_yticklabels(groups)
for i in range(10):
 for j in range(10):
  if net[i,j]:ax.text(j,i,f'{net[i,j]:,}',ha='center',va='center',fontsize=8,color='white' if np.log1p(net[i,j])>np.log1p(net.max())*.63 else '#233e35')
ax.set_xlabel('实际听众所属群体');ax.set_ylabel('说话者所属群体')
fig.colorbar(im,ax=ax,shrink=.75,label='色阶：ln(1 + 听见次数)');save('dialogue',fig)

# 7. Exact per-experiment content bytes vs event categories.
fig,axes=plt.subplots(1,2,figsize=(11.3,4.9));items=sorted([t for t in D['storage'] if t['bytes']>5000],key=lambda t:t['bytes'])
names={'continuous_events':'回放事件','continuous_snapshots':'完整快照','continuous_thoughts':'模型回复','continuous_contexts':'保留上下文','continuous_experiences':'个体经历（含索引文本）','continuous_runs':'世界状态','daily_news':'每日新闻','news_attempts':'新闻调用记录'}
axes[0].barh([names.get(t['table'],t['table']) for t in items],[t['bytes']/2**20 for t in items],color=C['green'])
axes[0].set_xscale('log');axes[0].set_xlabel('MiB，对数刻度');axes[0].set_title('本次实验：已存储内容')
for i,t in enumerate(items):axes[0].text(t['bytes']/2**20*1.07,i,f'{t["bytes"]/2**20:.2f}',va='center',fontsize=8)
items=sorted(D['eventBytes'].items(),key=lambda t:t[1])[-7:]
label={'action_started':'动作开始','idle':'等待完成','rest':'休息完成','body':'身体结算','work':'劳动完成','eat':'进食完成','think_started':'思考开始'}
axes[1].barh([label.get(k,k) for k,v in items],[v/2**20 for k,v in items],color=C['gold'])
axes[1].set_xlabel('压缩 payload，MiB');axes[1].set_title('回放体积来自哪些事件')
for ax in axes:grid(ax)
save('storage',fig)

# 8. Harvest efficiency and sustainable burden (flow budget, not current reserves).
harvest=[e for e in D['important'] if e['type']=='season'];yieldkg=[float(re.search(r'成熟 ([\d.]+)',e['text'])[1]) for e in harvest]
fig,axes=plt.subplots(1,2,figsize=(11.3,4.2));normal=sum(f['yieldKg'] for f in D['initial']['fields'])
xx=np.arange(2);axes[0].bar(xx-.18,[normal,normal*.5],.34,color=C['pale'],label='配置潜在产量')
axes[0].bar(xx+.18,yieldkg,.34,color=C['green'],label='实际成熟量');axes[0].set_xticks(xx);axes[0].set_xticklabels(['首次收获 / 显示D31','减产收获 / 显示D61']);axes[0].set_ylabel('kg / 月');axes[0].legend(frameon=False)
for i,y in enumerate(yieldkg):axes[0].text(i+.18,y+20,f'{y:.1f}',ha='center',fontsize=9)
need=29*30*R;tax=450*R
axes[1].barh(['减产周期产出','29人生存＋王税'],[yieldkg[1],need],color=C['green'],label='口粮/产出')
axes[1].barh(['减产周期产出','29人生存＋王税'],[0,tax],left=[0,need],color=C['red'],label='王税')
axes[1].set_xlabel('kg / 30日（29人、无库存结转假设）');axes[1].legend(frameon=False,loc='lower right');axes[1].invert_yaxis()
for ax in axes:grid(ax)
save('economy',fig)

# Narrative values and traceable evidence.
logical=sum(t['bytes'] for t in D['storage']);physical=sum(t['DATA_LENGTH']+t['INDEX_LENGTH'] for t in D['physical'])
byteShare=D['eventBytes'];eventTotal=sum(byteShare.values());routineBytes=sum(byteShare.get(k,0) for k in ['action_started','idle','rest','body','eat','work','walk','withdraw','deposit'])
failed=sum(t.get('think_failed',0) for t in daily.values());hunger=[d for d in D['deaths'] if '饥饿' in d['cause']];battle=[d for d in D['deaths'] if '战斗' in d['cause']]
armyEvent=next(e for e in D['important'] if e['type']=='royal' and '派出王军' in e['text']);armyDay=armyEvent['time']/DAY+1
lastDeath=D['deaths'][-1];duration=(lastDeath['time']-armyEvent['time'])/DAY
startArmy=next(m for m in M if m['x']==armyDay);available=startArmy['house']+startArmy['keep']+startArmy['public']+startArmy['carriedLocal']+startArmy['fields']
cache=D['usage']['prompt_cache_hit_tokens']/D['usage']['prompt_tokens']*100
attacks=[]
for e in D['operations']:
 hit=re.match(r'攻击 #(\d+)，造成 ([\d.]+)',e.get('text',''))
 if hit:attacks.append({**e,'target':int(hit[1]),'damage':float(hit[2])})
killers={}
for d in battle:
 a=next(e for e in reversed(attacks) if e['target']==d['id'] and e['seq']<d['seq']);killers[d['id']]=a['actor']
lastTime=D['head']['cutoff'];minute=int(lastTime//60000)%1440
clock=f'第 {int(lastTime//DAY)+1} 天 {minute//60:02}:{minute%60:02}'
esc=html.escape
fmt=lambda n:f'{n:,.0f}'
def image(name,caption):return f'<figure><img src="data:image/png;base64,{figures[name]}" alt="{esc(caption)}" loading="lazy"><figcaption>{esc(caption)}</figcaption></figure>'
def section(n,title,body):return f'<section id="s{n}"><div class="section-heading"><span>{n:02d}</span><h2>{title}</h2></div>{body}</section>'
def callout(title,text):return f'<aside class="callout"><strong>{title}</strong><p>{text}</p></aside>'
def evidence(seq,text):return f'<span class="event">E{seq}</span> {esc(text)}'

sections=[]
sections.append(section(1,'结果：约三天内，本地社会被消灭',f'''
<p class="lead">截止{clock}，初始32名居民无一存活；王使和10名王军全部存活。最后一名居民河湾·长子 #22 于显示第89天末死亡。</p>
<div class="insights"><article><b>29 / 32</b><h3>死于战斗</h3><p>29次致死伤害均可追溯到王军。王使与领主此前交战，但没有造成这29例中的致死一击。</p></article><article><b>3 / 32</b><h3>死于持续饥饿</h3><p>两例与早期计划格式失败直接相关；另一例暴露了求援导航与自动农活之间的冲突。</p></article><article><b>{duration:.2f} 日</b><h3>王军入境至最后死亡</h3><p>出兵前还有29名本地活人；改进王军目标分配后，战斗迅速扩散到多个家庭。</p></article></div>
{image('population','按事件时间绘制的在场存活人数；底部短线标示32次死亡。王军与王使不计入本地居民。')}
<p>这次结果更接近<strong>税收执行失败后发生的确定性镇压</strong>，而不是已被数据证实的农民起义。完成的攻击记录中，没有本地居民攻击领主的事件；国王最终状态也没有使者提交的 rebellion 字段。仅凭这些证据，不能把拒绝交付、争执或被镇压直接等同于“自发造反”。</p>
'''))

importantTimeline=[('D11 16:30','两名居民在粮仓旁饿死','艾达 #6、石桥·长子 #26：各22次思考失败，零成功计划。'),('D31 00:00','第一轮收获','成熟1268.38kg，为正常潜在产量的95.83%。'),('D36 → D46','第一期王税迟交后补齐','首日仅扣119.78kg，之后多次补缴，累计补足330.88kg。'),('D41 / D61','歉收启用 / 减产兑现','倍率先切到50%，到下一次月末才体现为615.97kg成熟量。'),('D62 07:46','第三例饥饿死亡','麦田·母 #9 身上无粮；求援导航结束后被自动农活带回原田。'),('D66 → D87','第二期欠税触发军队','欠款最终停在118.36kg；连续拖欠超过20个结算日后出兵。'),('D87 → D89末','王军入境与集中死亡','先在广场交战，随后进入庄园与家庭住宅；领主于D89 00:56死亡。')]
sections.append(section(2,'事件链：先是欠税，后是军事介入','<div class="timeline">'+''.join(f'<article><span>{a}</span><div><h3>{b}</h3><p>{c}</p></div></article>' for a,b,c in importantTimeline)+'</div>'+callout('日期口径必须区分','引擎在完成第N个游戏日时执行月末/税务结算，界面此刻显示第N+1天00:00。因此配置“第30天收获、第35天税期、第40天歉收”，在本报告时间轴上分别表现为D31、D36、D41。本报告统一使用界面日期；截止点是D90中途，尚未发生第90日结束时的第三次收获。')))
sections.append(section(3,'农业能生产，减产后的长期预算却失衡',f'''
<p>两轮成熟量分别为 <strong>{yieldkg[0]:.2f}kg</strong> 和 <strong>{yieldkg[1]:.2f}kg</strong>，合计{final['grown']:.2f}kg。对应各自配置潜力的 {yieldkg[0]/normal*100:.1f}% 和 {yieldkg[1]/(normal*.5)*100:.1f}%。农活完成度并不低，不能把结果概括为“大家只说话、不耕种”。</p>
{image('economy','左：实际收获与劳动全部完成时的潜在产量。右：29人持续生活30日加固定王税的稳态流量比较。')}
<p>减产后，29人每30日约需 {need:.2f}kg 口粮，加王税 {tax:.2f}kg，合计 {need+tax:.2f}kg；当前周期实际产出仅 {yieldkg[1]:.2f}kg，稳态缺口约 <strong>{need+tax-yieldkg[1]:.2f}kg/周期</strong>。这会侵蚀此前库存，但不意味着当时所有粮食已经耗尽。</p>
<p>如果仍按“五成收成上缴”惯例分配，减产周期的领主份额约{yieldkg[1]*.5:.2f}kg，甚至不足以独自覆盖{tax:.2f}kg固定王税，尚未计入庄园人员饮食。固定王税在实际收获中的占比由 {tax/yieldkg[0]*100:.1f}% 升至 {tax/yieldkg[1]*100:.1f}%。</p>
'''))
sections.append(section(4,'粮食没有消失，而是留在不同人的储藏里',f'''
{image('grain','上：本地家庭、公共储藏、活人随身和成熟田间谷物；不包括王室人员与尸体随身粮。下：庄园及公共粮箱的局部供应。')}
<p>王军入境时，可在全图盘点到的家庭/公共储粮、本地活人随身粮与成熟田粮合计 <strong>{available:.2f}kg</strong>，而当时欠税 {startArmy['arrears']:.2f}kg。按29人标准口粮估算，即使先补齐欠款，剩余约可维持 <strong>{(available-startArmy['arrears'])/(29*R):.1f}日</strong>；距离下一次月末收获只有4日。</p>
{callout('这是总量可行性，不是角色实际取粮能力','上述假设把全图粮食视为可即时调度。真实 Agent 受到仓库钥匙、位置、转运时间、家庭保留意愿和命令执行方式影响。数据支持“粮食分布和交付机制阻碍了税收/口粮流转”，不能据此断言任何单一角色在自己的可见信息下都应做出最优调度。')}
<p>截止快照，六户家庭仍有 <strong>{final['house']:.2f}kg</strong> 谷物，庄园、公共粮箱和王税仓均为0。另有{final['corpses']:.2f}kg留在尸体身上、{final['fields']:.2f}kg留在成熟田间。因此，灭绝的直接原因是武力清除；局部断粮与长期预算恶化是此前的压力来源。</p>
'''))
sections.append(section(5,'王税机制：首期补齐，第二期欠款导致出兵',f'''
{image('tax','税额统一换算为kg；首期与第二期各450人日粮，约330.88kg。欠款和累计实缴按日末状态阶梯绘制。')}
<p>两期到期王税合计 {2*tax:.2f}kg，实际累计入王室 {final['paid']:.2f}kg，仍欠 {final['arrears']:.2f}kg。首期在D46清零；第二期D66产生欠款，最后一次补缴在D79，此后欠款没有继续下降。</p>
<p>{evidence(armyEvent['seq'],armyEvent['text'])}。当时欠税起点为内部结算日65，出兵检查发生在内部日86：86−65=21，严格大于2×10。领主此时尚活着，因此本次出兵由持续欠税触发；领主后续死亡不能倒推为出兵原因。</p>
<p>王使有对领主施压的实际攻击：双方各完成6次攻击。与此不同，29名战斗死者的最后一击均来自王军。报告按实际攻击结算与死因记录区分这两段冲突，没有把对话中的威胁当作已经发生的杀戮。</p>
'''))
sections.append(section(6,'个体轨迹：三例饥饿死亡不是同一种问题',f'''
{image('health','初始32名居民的生命值。浅色叉号为精确死亡时刻；矩阵取各日边界快照，死亡后置0。')}
<div class="case-grid"><article><span class="pill">工程故障证据强</span><h3>#6 艾达 · #26 石桥·长子</h3><p>各22次思考全部标记失败，没有成功计划，也没有领取食物事件。死亡时两人随身粮均为0，而身旁、持钥匙可进入的粮仓分别有125.52kg和70.63kg。</p><p>已保存上下文显示两人持续输出顶层 <code>type: json_object</code> 并尝试自救。此后 parser 已修正该兼容问题，但这两例死亡保留在实验中，不能作为自主生存能力的干净测量。</p></article><article><span class="pill amber">规则与计划耦合</span><h3>#9 麦田·母</h3><p>D61 19:59下令前往plot-5求援；21:08到达后，自动work日程立即把她带回plot-3继续耕作。到D62 07:15，她生命0.2、随身粮0、fetch=false、work=true。</p><p>模型最后才关闭work并再次求援。死亡时家庭仓仍有15.67kg，但已不在现场可见范围。这里既有模型补粮决策不足，也有一次性导航完成后立即恢复农活的协议问题。</p></article></div>
<p>本地居民攻击王军的完成动作只有15次，王军对居民完成139次攻击，王军无人死亡。此差异同时受装备、防御、外部补给和确定性目标分配影响，不能只归因于居民“没有反抗意愿”。</p>
'''))
sections.append(section(7,'决策与对话：有交流，有劳动，也有执行损失',f'''
{image('decisions','次数统计。一次work代表一个完成的劳动动作，不能直接和一条发言换算成等量时间或贡献。Day90为部分日。')}
<p>记录包含 {fmt(D['kinds']['think_finished'])} 次思考完成事件，其中 {failed} 次标记失败（{failed/D['kinds']['think_finished']*100:.2f}%）；另有5条计划被引擎拒绝。成功写入的计划事件为{fmt(D['kinds']['plan'])}条，实际完成发言{fmt(D['kinds']['speech'])}条、劳动动作{fmt(D['kinds']['work'])}次、收割动作{fmt(D['kinds']['harvest'])}次。</p>
<p>6号与26号贡献了44次失败，占全部标记失败的{44/failed*100:.1f}%。其余失败、模型返回、恢复时结算和事件记录分属不同层次，因此不能把“请求总数减失败数”直接当成实际执行动作数。</p>
{image('dialogue','消息接触矩阵：每条实际发言对每名实际听众计一次，再聚合到家庭/身份群体。同一群体内多人听见会多计，不代表多次讲话；颜色采用对数刻度。')}
<p>对话确实跨越家庭边界并连接庄园、村长和使者。这个图衡量<strong>谁实际听到了谁</strong>，不推断信任、服从、共识或合作成功。对话中出现的物资承诺必须结合取放粮事件检查，不能直接计为税粮已到账。</p>
'''))
sections.append(section(8,'数据库占用：回放事件是主要成本',f'''
<div class="metric-row"><article><small>本实验内容字段，精确字节计量</small><b>{logical/2**20:.2f} <em>MiB</em></b><p>{fmt(logical)} bytes · {logical/1e6:.2f} MB</p></article><article><small>整个数据库：表数据＋索引，元数据估计</small><b>{physical/2**30:.2f} <em>GiB</em></b><p>包含旧离散实验与其他连续实验</p></article></div>
{image('storage','按MySQL OCTET_LENGTH聚合已存储字段；回放等payload已压缩，经历同时计payload及重复检索文本。没有给本实验虚构独占的物理磁盘占用。')}
<p>回放事件共有{fmt(D['kinds'] and D['checks']['events'])}条，压缩payload为{eventTotal/2**20:.2f}MiB，占本次内容体积<strong>{eventTotal/logical*100:.2f}%</strong>。仅动作开始、等待完成、休息完成和身体结算四类就占回放内容{sum(byteShare[k] for k in ['action_started','idle','rest','body'])/eventTotal*100:.1f}%。这说明压缩JSON仍反复保留了大量角色状态；模型回复本身仅{next(t['bytes'] for t in D['storage'] if t['table']=='continuous_thoughts')/2**20:.2f}MiB。</p>
<div class="table-wrap"><table><thead><tr><th>表</th><th>本实验行数</th><th>计入字段</th><th>MiB</th></tr></thead><tbody>{''.join(f'<tr><td><code>{t["table"]}</code></td><td>{t["rows"]:,}</td><td>{", ".join(t["columns"]) or "仅计行数"}</td><td>{t["bytes"]/2**20:.3f}</td></tr>' for t in sorted(D['storage'],key=lambda t:-t['bytes']))}</tbody></table></div>
<p class="note">本实验计量未包含主键字符串、数值列、页头、索引、页空洞及事务日志；它是可准确归属的内容体积，不是独占磁盘文件大小。整个数据库数字来自information_schema的DATA_LENGTH＋INDEX_LENGTH，InnoDB元数据可能有估计误差，不包含binlog/redo/undo等独立文件，也不把DATA_FREE重复计入。</p>
{callout('下一步存储优化应保留回放语义','优先把反复保存的完整Agent行改成字段级变化或动作结算记录；连续等待/休息可用有起止时间的区间表示，身体数值按确定性函数恢复。配合周期快照及状态哈希校验。这里给出优化方向，未删除或改写本次数据库。')}
'''))
sections.append(section(9,'模型消耗与实验有效性',f'''
<div class="metric-row three"><article><small>居民模型输入</small><b>{D['usage']['prompt_tokens']/1e6:.2f}<em>M tokens</em></b></article><article><small>输入缓存命中</small><b>{cache:.2f}<em>%</em></b></article><article><small>居民模型输出</small><b>{D['usage']['completion_tokens']/1e6:.2f}<em>M tokens</em></b></article></div>
<p>供应商usage存档共{D['attempts']['requests']:,}条请求结果；可见的输入缓存未命中量为{D['usage']['prompt_cache_miss_tokens']/1e6:.2f}M tokens。新闻流另消耗输入{D['newsUsage'].get('prompt_tokens',0)/1e6:.2f}M、输出{D['newsUsage'].get('completion_tokens',0)/1e6:.3f}M。没有稳定价格与完整账单，报告不估算货币费用。</p>
<p>usage请求记录与世界思考完成事件相差{D['kinds']['think_finished']-D['attempts']['requests']}条，不能逐条等同；早期结果缺少完整attempts分项，压缩与重试占比不能从当前attempt字段完整回溯。缓存命中率来自供应商token计量，不等于全部成本已经低廉。</p>
<div class="limitations"><h3>哪些结论可以相信？</h3><ul><li><strong>确定事实：</strong>当前存活名单、32次死亡、各次实际收获/税款、事件时间与库存分布均可由存档重放。</li><li><strong>有证据的机制问题：</strong>早期格式拒绝阻断取粮；出口被错误标为家庭粮仓；导航完成后自动农活恢复。不同问题的修复已在同一实验中途发生。</li><li><strong>需要对照实验：</strong>减产是否导致反叛、独裁程度是否改变合作、王军是否过强。此次是单次且多次修改引擎的运行，缺少固定版本、重复种子和对照组。</li><li><strong>军事阶段有干预：</strong>分散锁定/破门导航在E280430附近暂停后上线，发生于王军已经入境之后。因此D87之后的生存曲线混合了两版军队策略。</li><li><strong>供给不对称：</strong>王军每天自动补足约10日口粮；居民依赖真实生产与转运。王室人员全部存活不意味着其自主生存策略优于居民。</li></ul></div>
<p>下一轮建议先固定parser与自动任务协议，再以相同种子分别运行：正常产量/减产、现行王税/随产量变化王税、现行军队/延后出兵。把“税款是否实际入仓”“求援后是否得到食物”“暴力是否由居民主动发起”作为可观测结果，避免只用存活数评价社会形成。</p>
'''))

# Searchable, evidence-linked death register.
rows=''
for d in D['deaths']:
 t=d['time'];minute=int(t//60000)%1440;when=f'D{int(t//DAY)+1} {minute//60:02}:{minute%60:02}'
 cause='饥饿' if '饥饿' in d['cause'] else '战斗'
 rows+=f'<tr data-cause="{cause}"><td><b>#{d["id"]}</b> {esc(d["name"])}</td><td>{when}</td><td><span class="pill {"amber" if cause=="饥饿" else ""}">{cause}</span></td><td>{"王军 #"+str(killers[d["id"]]) if d["id"] in killers else "—"}</td><td>{d["grain"]:.2f}</td><td>{d["homeGrain"]:.2f}</td><td><code>E{d["seq"]}</code></td></tr>'
sections.append(section(10,'死亡登记：逐人核验',f'''<div class="filters"><label>检索角色 <input id="search" placeholder="输入姓名、编号或事件号"></label><label>死因 <select id="cause"><option value="">全部</option><option>饥饿</option><option>战斗</option></select></label><span id="count">32 条记录</span></div><div class="table-wrap"><table id="deaths"><thead><tr><th>居民</th><th>死亡时间</th><th>死因</th><th>最后一击来源</th><th>随身粮 kg</th><th>家庭仓 kg</th><th>事件</th></tr></thead><tbody>{rows}</tbody></table></div><p class="note">家庭仓数值为死亡时的全知库存，不保证死者在交互距离内，也不表示这些粮食可即时食用。最后一击按此前最近的已结算攻击记录匹配。</p>'''))

quotes=[]
for term in ['不开、不交','第一把give我一口','税仓0、欠']:
 e=next((e for e in D['speeches'] if term in e['text']),None)
 if e and e not in quotes:quotes.append(e)
quotehtml=''.join(f'<blockquote><p>{esc(e["text"])}</p><footer>#{e["actor"]} {esc(roster[e["actor"]]["name"])} · E{e["seq"]} · D{e["time"]/DAY+1:.2f}</footer></blockquote>' for e in quotes)
sections.append(section(11,'原始话语与可复核方法',quotehtml+f'''
<p>数据读取于 <strong>{esc(D['extracted'])}</strong>，实验ID <code>{esc(D['run'])}</code>，边界 <code>E{D['head']['seq']}</code>。单个只读一致性事务读取主要数据，逐条应用事件补丁；序列无缺口，回放最终角色数组与数据库头部一致。粮食账本在全部日边界的最大守恒误差为{D['checks']['maxBalanceResidual']:.2e}kg（浮点量级）。</p>
<p>配套数据 <a href="data.json">data.json</a>；Python图表由Matplotlib生成，已嵌入此HTML，可单独离线打开。生成源码位于项目 <code>scripts/reports/extract_day90.py</code> 与 <code>scripts/reports/render_day90.py</code>。本报告没有调用LLM做自动定性打分，也没有修改实验数据。</p>
<details><summary>实验配置原值</summary><pre>{esc(json.dumps(D['settings'],ensure_ascii=False,indent=2))}</pre><p>存档中的旧字段maxCalls仅为遗留配置；当前连续模式已不执行该规划额度限制。</p></details>
'''))

css='''
:root{--ink:#243d34;--muted:#6e7c73;--paper:#f2f1e8;--card:#fbfaf6;--line:#dedfd4;--accent:#ba5437;--green:#246854}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:var(--green);text-underline-offset:4px}header{background:#233e35;color:#fbf6e8;padding:76px max(6vw,24px) 58px;position:relative;overflow:hidden}header:after{content:"90";position:absolute;right:5%;top:-80px;font:420px/1.2 Georgia,serif;color:#ffffff07;pointer-events:none}.eyebrow{font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#c3cdaf}h1{font:clamp(42px,6vw,74px)/1.25 "Songti SC",Georgia,serif;letter-spacing:1px;margin:24px 0 18px;max-width:950px}header p{max-width:760px;color:#cdd5c8;font-size:18px}.meta{display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid #ffffff26;padding-top:24px;margin-top:36px;font-size:12px;letter-spacing:1px}.shell{max-width:1500px;margin:auto;display:grid;grid-template-columns:200px minmax(0,1fr);gap:42px;padding:48px 5vw}.nav{position:sticky;top:28px;height:fit-content;font-size:13px}.nav a{display:block;text-decoration:none;padding:8px 0;color:var(--muted);border-bottom:1px solid var(--line)}.nav a:hover{color:var(--accent)}.nav small{display:block;letter-spacing:2px;color:var(--green);margin-bottom:12px}main{min-width:0}section{scroll-margin-top:24px;margin-bottom:72px}.section-heading{display:flex;align-items:baseline;gap:18px;border-top:2px solid var(--ink);padding-top:18px;margin-bottom:20px}.section-heading>span{color:var(--accent);font:22px Georgia,serif}h2{font:600 28px/1.4 "Songti SC",Georgia,serif;margin:0}h3{font-size:17px;line-height:1.5;margin:12px 0 8px}p{margin:16px 0}.lead{font-size:21px;line-height:1.8}.insights,.case-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:26px 0}.insights article,.case-grid article{background:var(--card);border:1px solid var(--line);padding:24px}.insights b{font:42px Georgia,serif;color:var(--green)}.insights p,.case-grid p{font-size:14px;color:#5f6d64}.case-grid{grid-template-columns:1fr 1fr}.metric-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:24px 0}.metric-row.three{grid-template-columns:repeat(3,1fr)}.metric-row article{padding:22px;background:var(--card);border-bottom:3px solid var(--green)}.metric-row small{display:block;color:var(--muted);font-size:12px}.metric-row b{display:block;font:40px/1.7 Georgia,serif;white-space:nowrap}.metric-row em{font:13px sans-serif;color:var(--muted);margin-left:5px}.metric-row p{margin:0;font-size:12px;color:var(--muted)}figure{margin:28px 0;background:var(--card);border:1px solid var(--line);padding:12px 12px 0;border-radius:3px}figure img{display:block;width:100%;height:auto}figcaption{padding:12px 18px 18px;font-size:12px;color:var(--muted);border-top:1px solid #eeeeE5}.callout{background:#e8ecdf;border-left:4px solid var(--green);padding:20px 24px;margin:24px 0}.callout p{font-size:14px;margin:8px 0 0}.timeline article{display:grid;grid-template-columns:150px 1fr;gap:24px;padding:18px 0;border-bottom:1px solid var(--line)}.timeline article>span{font:16px/1.8 Georgia,serif;color:var(--accent)}.timeline h3{margin:0}.timeline p{margin:6px 0 0;font-size:14px;color:var(--muted)}code{font:12px/1.5 ui-monospace,Menlo,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#ebece2;padding:20px;font-size:12px}.table-wrap{overflow-x:auto;margin:24px 0}table{border-collapse:collapse;width:100%;font-size:12px;min-width:650px}th{text-align:left;background:#e3e7da;padding:12px 10px;white-space:nowrap}td{border-bottom:1px solid var(--line);padding:12px 10px;vertical-align:top}tbody tr:nth-child(2n){background:#faf9f280}.note{font-size:12px;color:var(--muted)}.pill{display:inline-block;font-size:11px;background:#f0e0d6;color:#8e422b;padding:2px 9px;border-radius:20px;white-space:nowrap}.pill.amber{background:#eae2c9;color:#7d642b}.event{font:12px monospace;background:#e3e7da;padding:3px 7px;border-radius:3px}.limitations{border:1px solid var(--line);padding:20px 26px;background:var(--card)}li{padding:7px 0}.filters{display:flex;align-items:center;gap:20px;flex-wrap:wrap;font-size:13px}.filters input,.filters select{border:1px solid #cbd0c1;border-radius:4px;padding:10px;background:var(--card);font:inherit}.filters label{display:flex;gap:8px;align-items:center}#count{color:var(--muted)}blockquote{margin:24px 0;padding:10px 24px;border-left:2px solid var(--accent);background:#fbfaf6}blockquote p{font:17px/1.9 "Songti SC",serif}blockquote footer{font-size:12px;color:var(--muted)}details{border:1px solid var(--line);padding:16px;margin-top:22px}summary{cursor:pointer}.end{background:#233e35;padding:30px;text-align:center;color:#cdd5c8;font-size:12px;letter-spacing:2px}@media(max-width:1000px){.shell{grid-template-columns:1fr;padding:28px 5vw}.nav{position:static;display:flex;gap:12px;overflow:auto;white-space:nowrap}.nav small{display:none}.nav a{font-size:12px}.insights{grid-template-columns:1fr}.metric-row.three{grid-template-columns:1fr}.metric-row b{font-size:34px}}@media(max-width:600px){header{padding-top:40px}.case-grid,.metric-row{grid-template-columns:1fr}h2{font-size:24px}.timeline article{grid-template-columns:100px 1fr;gap:12px}.shell{padding:24px 16px}figure{padding:0}figcaption{padding:12px}.filters{gap:12px}}@media print{body{background:white;font-size:11px}.shell{display:block;padding:0}.nav,.filters{display:none}header{padding:30px;print-color-adjust:exact}h1{font-size:38px}section{margin-bottom:35px}figure,.case-grid,.insights{break-inside:avoid}figure img{max-height:650px;object-fit:contain}table{min-width:0}.section-heading{break-after:avoid}details{display:none}}
'''
titles=['存活结局','事件时间线','农业与负担','粮食分布','王税与出兵','个体死亡','决策与对话','数据库体积','有效性与成本','死亡登记','来源与方法']
nav=''.join(f'<a href="#s{i}">{i:02d}　{title}</a>' for i,title in enumerate(titles,1))
page=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="鸦溪领地连续实验Day90：人口、粮食、税收、决策与数据库存储的可复核分析"><title>粮食尚存，领地已空｜鸦溪领地 Day 90 实验报告</title><style>{css}</style></head><body><header><div class="eyebrow">Ravenbrook / Experimental Field Report / No. 090</div><h1>粮食尚存，领地已空</h1><p>一次从纳税协作走向全体覆灭的连续 Agent 实验。<br>以实际事件、粮食账本与决策轨迹重建结局。</p><div class="meta"><span>截止 {clock}</span><span>32 名本地居民 → 0</span><span>王室人员 11 / 11 存活</span><span>286,930 条事件核验</span></div></header><div class="shell"><nav class="nav" aria-label="报告目录"><small>REPORT CONTENTS</small>{nav}</nav><main>{''.join(sections)}</main></div><footer class="end">AGENT WORLD · 连续庄园实验 · 数据驱动复盘</footer><script>const search=document.querySelector('#search'),cause=document.querySelector('#cause');function filter(){{let n=0;document.querySelectorAll('#deaths tbody tr').forEach(r=>{{const show=r.textContent.toLowerCase().includes(search.value.trim().toLowerCase())&&(!cause.value||r.dataset.cause===cause.value);r.hidden=!show;if(show)n++}});document.querySelector('#count').textContent=n+' 条记录'}}search.addEventListener('input',filter);cause.addEventListener('change',filter);</script></body></html>'''
(OUT/'index.html').write_text(page)
summary={'logicalBytes':logical,'logicalMiB':logical/2**20,'databaseGiB':physical/2**30,'eventShare':eventTotal/logical,'dead':len(D['deaths']),'hunger':len(hunger),'combat':len(battle),'armyDay':armyDay,'lastDeathDay':lastDeath['time']/DAY+1,'armyPeriod':duration,'allBattleDeathsByArmy':all(a>=34 for a in killers.values()),'availableAtInvasion':available,'arrears':final['arrears'],'cachePercent':cache,'htmlBytes':(OUT/'index.html').stat().st_size}
(OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print(json.dumps(summary,ensure_ascii=False))
