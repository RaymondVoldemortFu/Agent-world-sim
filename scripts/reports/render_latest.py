"""Self-contained, evidence-linked HTML audit of the latest continuous manor run."""
from pathlib import Path
from collections import Counter,defaultdict
import json,html,base64,re,statistics
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.colors import LogNorm
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'reports/latest-manor';D=json.loads((OUT/'data.json').read_text());DAY=86400000;R=2500/3400
fm.fontManager.addfont('/System/Library/Fonts/STHeiti Light.ttc')
plt.rcParams.update({'font.family':fm.FontProperties(fname='/System/Library/Fonts/STHeiti Light.ttc').get_name(),'font.size':10,'axes.unicode_minus':False,'axes.spines.top':False,'axes.spines.right':False,'axes.edgecolor':'#d6dcd8','text.color':'#203745','axes.labelcolor':'#435866','xtick.color':'#60717b','ytick.color':'#60717b','figure.facecolor':'#fcfcf8','axes.facecolor':'#fcfcf8','grid.color':'#e0e5df','savefig.facecolor':'#fcfcf8'})
C=['#2b786a','#d66a42','#d4ae57','#5b87a0','#a1bba5','#a597ba']
M=D['metrics'];F=M[-1];x=np.array([m['x'] for m in M]);end=F['x'];roster={a['id']:a for a in D['final']['agents']};figures={}
clock=lambda t:f'D{int(t//DAY)+1} {int(t//3600000)%24:02}:{int(t//60000)%60:02}'
esc=lambda s:html.escape(str(s))
def save(name,fig):
 fig.tight_layout(pad=1.5);p=OUT/(name+'.png');fig.savefig(p,dpi=160,bbox_inches='tight');plt.close(fig);figures[name]=base64.b64encode(p.read_bytes()).decode()
def axesstyle(ax):ax.grid(axis='y',alpha=.65);ax.set_axisbelow(True)
def timeaxis(ax,lo=1):ax.set_xlim(lo,end+.5);ax.set_xlabel('UI 日期（D31 = 首次月末成熟之后）');axesstyle(ax)
def mark(ax,day,label):ax.axvline(day,ls=':',color='#8c979e',lw=1);ax.text(day+.3,.94,label,transform=ax.get_xaxis_transform(),fontsize=8,va='top',color='#697b86')
# Population + tax: event-exact mortality, tax daily boundaries.
fig,axs=plt.subplots(2,1,figsize=(11.5,6.4),sharex=True,gridspec_kw={'height_ratios':[1,1.2]})
p=D['population'];
for k,label,c in [('locals','本地居民',C[0]),('army','王军',C[1]),('messenger','使者',C[2])]:axs[0].step([v['x'] for v in p],[v[k] for v in p],where='post',lw=2.3,label=label,color=c)
axs[0].set_ylabel('在场存活人数');axs[0].legend(ncol=3,frameon=False,loc='upper center');axesstyle(axs[0]);axs[0].set_ylim(-.8,36)
axs[1].step(x,[m['paid'] for m in M],where='post',label='累计实缴王税',color=C[0],lw=2)
axs[1].step(x,[m['arrears'] for m in M],where='post',label='当前欠税',color=C[1],lw=2)
axs[1].step(x,[0 if v<36 else 450*R if v<66 else 900*R for v in x],where='post',label='累计到期应缴',color=C[2],ls='--')
for d,s in [(36,'首期'),(66,'第二期'),(87,'王军入境')]:mark(axs[1],d,s)
axs[1].set_ylabel('谷物 kg');axs[1].legend(ncol=3,frameon=False,loc='upper left');timeaxis(axs[1]);save('outcome',fig)
# Stocks and economics
fig,axs=plt.subplots(2,1,figsize=(11.5,6.6),sharex=True,gridspec_kw={'height_ratios':[1.7,1]})
keys=['house','keep','public','tax','carriedLocal','fields'];labels=['家庭储藏','庄园粮仓','村庄粮仓','王税粮仓','本地活人随身','田间成熟待搬']
axs[0].stackplot(x,*[[m[k] for m in M] for k in keys],labels=labels,colors=C,alpha=.88,step='post')
axs[0].legend(ncol=3,frameon=False,loc='upper right',fontsize=9);axs[0].set_ylabel('本地可分配库存 kg');axesstyle(axs[0])
for k,l,c in [('keep','庄园粮仓',C[1]),('carriedLocal','全体活人随身',C[3]),('arrears','王税欠款',C[2])]:axs[1].plot(x,[m[k] for m in M],label=l,color=c,lw=2)
axs[1].set_ylabel('kg');axs[1].legend(ncol=3,frameon=False);timeaxis(axs[1]);save('stocks',fig)
normal=sum(f['yieldKg'] for f in D['initial']['fields']);yields=[float(re.search(r'成熟 ([\d.]+)',e['text'])[1]) for e in D['important'] if e['type']=='season']
fig,axs=plt.subplots(1,2,figsize=(11.5,4.1));xx=np.arange(2)
axs[0].bar(xx-.18,[normal,normal*.5],.35,color='#bdd0c6',label='配置产能');axs[0].bar(xx+.18,yields,.35,color=C[0],label='实际成熟');axs[0].set_xticks(xx,['D31 首次收获','D61 减产收获']);axs[0].set_ylabel('kg / 周期');axs[0].legend(frameon=False)
for i,v in enumerate(yields):axs[0].text(i+.18,v+20,f'{v:.2f}',ha='center')
need=32*30*R;tax=450*R
axs[1].barh(['减产周期实际产出','32人30日口粮＋王税'],[yields[1],need],color=C[0],label='粮食/口粮');axs[1].barh(['减产周期实际产出','32人30日口粮＋王税'],[0,tax],left=[0,need],color=C[1],label='王税');axs[1].invert_yaxis();axs[1].set_xlabel('kg（未计库存结转、胃内能量及王室补给）');axs[1].legend(frameon=False,loc='lower right')
for ax in axs:axesstyle(ax)
save('budget',fig)
# Individual supplies: finance's bag vs common store, D65 onwards
fig,ax=plt.subplots(figsize=(11.5,3.7));h=D['health'];hx=[v['x'] for v in h]
ax.plot(hx,[v['agents'].get('32',{}).get('grain',0) for v in h],color=C[3],lw=2.5,label='财政官个人随身粮')
ax.plot(x,[m['keep'] for m in M],color=C[1],lw=2,label='庄园粮仓')
ax.axhline(7*R,color=C[0],ls='--',label=f'一人七日口粮 {7*R:.2f}kg');ax.axhline(49*R,color=C[2],ls=':',label=f'七人七日口粮 {49*R:.2f}kg')
ax.set_ylim(0,215);ax.set_ylabel('kg');timeaxis(ax,66);ax.legend(ncol=2,frameon=False);mark(ax,77,'取粮后停止拨税');save('finance',fig)
# Heatmap
heat=np.array([[v['agents'].get(str(a),{}).get('hp',np.nan) for v in h] for a in range(1,33)])
fig,ax=plt.subplots(figsize=(11.5,7.2));edges=np.r_[hx[0]-.5,(np.array(hx[:-1])+np.array(hx[1:]))/2,hx[-1]+.1];img=ax.pcolormesh(edges,np.arange(.5,33.5),heat,cmap='RdYlGn',vmin=0,vmax=100,shading='flat');ax.set_ylim(32.5,.5);ax.set_yticks(range(1,33),[f'#{a} {roster[a]["name"]}' for a in range(1,33)],fontsize=8);ax.set_xlabel('UI 日期；按日末采样，死亡时刻另以 × 标示')
for d in D['deaths']:ax.scatter(d['time']/DAY+1,d['id'],marker='x',s=14,c='#152c3e',lw=.6)
ax.set_xlim(1,end+.5);fig.colorbar(img,ax=ax,label='记录生命值',shrink=.65);save('health',fig)
# Actual speech contacts by social group
names=['领主','税收官','管家','武装随从','村长','财政官','麦田','磨坊','榆树','河湾','石桥','牧钟','使者','王军']
def group(a):
 if a in [1,2,3]:return a-1
 if a in [4,5,6]:return 3
 if a==7:return 4
 if a==32:return 5
 if 8<=a<=31:return 6+(a-8)//4
 return 12 if a==33 else 13
matrix=np.zeros((14,14));
for s in D['speeches']:
 for to in s['listeners'] or []:matrix[group(s['actor']),group(to)]+=1
fig,axs=plt.subplots(1,2,figsize=(11.5,5),gridspec_kw={'width_ratios':[1.45,1]});im=axs[0].imshow(np.ma.masked_equal(matrix,0),norm=LogNorm(vmin=1,vmax=max(2,matrix.max())),cmap='YlGnBu');axs[0].set_xticks(range(14),names,rotation=55,ha='right',fontsize=8);axs[0].set_yticks(range(14),names,fontsize=8);axs[0].set_ylabel('发言者');axs[0].set_xlabel('实际听众（每人次计一条边）');fig.colorbar(im,ax=axs[0],shrink=.7,pad=.02)
channels=Counter(s['channel'] for s in D['speeches']);silent=Counter(s['channel'] for s in D['speeches'] if not s['listeners']);chs=list(channels)
axs[1].bar(chs,[channels[k]-silent[k] for k in chs],label='至少一名听众',color=C[0]);axs[1].bar(chs,[silent[k] for k in chs],bottom=[channels[k]-silent[k] for k in chs],label='无人听见',color=C[1]);axs[1].set_ylabel('完成发言条数');axs[1].tick_params(axis='x',labelsize=8);axs[1].legend(frameon=False);axesstyle(axs[1]);save('dialogue',fig)
# Operations, calls and database
fig,axs=plt.subplots(1,2,figsize=(11.5,4));days=sorted(map(int,D['daily']));daily=D['daily']
axs[0].plot(days,[daily[str(d)].get('think_finished',0) for d in days],color=C[3],label='思考完成');axs[0].plot(days,[daily[str(d)].get('speech',0) for d in days],color=C[0],label='实际发言');axs[0].set_xlabel('UI 日期（D90为部分日）');axs[0].set_ylabel('次数');axs[0].legend(frameon=False);axesstyle(axs[0])
slots=sorted(D['eventBytes'],key=lambda k:-D['eventBytes'][k])[:6];axs[1].barh(slots,[D['eventBytes'][k]/2**20 for k in slots],color=[C[1],C[3],C[0],C[2],C[4],C[5]]);axs[1].invert_yaxis();axs[1].set_xlabel('事件压缩payload · MiB');axesstyle(axs[1]);save('runtime',fig)
# Gather report values and evidence
logical=sum(s['bytes'] for s in D['storage']);cache=D['usage']['prompt_cache_hit_tokens']/D['usage']['prompt_tokens'];army=next(e for e in D['important'] if '派出王军' in e['text']);duration=(D['deaths'][-1]['time']-army['time'])/DAY
payby=Counter()
for t in D['transfers']:
 for c in t['changes']:
  if c['store']=='royal-tax-store' and c['delta']>0:payby[t['actor']]+=c['delta']
lat=sorted(r['elapsedMs']/1000 for r in D['modelRows'] if r['elapsedMs'] is not None)
firstempty=sum(not s['listeners'] for s in D['speeches']);modelerror=sum(bool(r['error']) for r in D['modelRows']);m66=next(m for m in M if m['x']==66);available66=sum(m66[k] for k in ['house','keep','tax','public','carriedLocal','fields']);reserve66=available66-m66['arrears']-33*25*R
m87=next(m for m in M if m['x']==87);available87=sum(m87[k] for k in ['house','keep','public','carriedLocal','fields'])
# Evidence browser: exact recorded text, unique seq, no raw patches or foreign private context.
events={}
for series in ['important','plans','operations','speeches','errors','alarms','letterEvents','transfers']:
 for e in D[series]:
  events[e['seq']]={'seq':e['seq'],'d':round(e['time']/DAY+1,4),'clock':clock(e['time']),'actor':e.get('actor'),'kind':e.get('type') or ('plan' if series=='plans' else 'speech' if series=='speeches' else 'door_noise'),'text':e.get('text','')}
def ref(seq):return f'<button class="ref" data-evidence="{seq}">E{seq} ↗</button>'
def quote(seq,title):return f'<blockquote><div>{esc(title)} {ref(seq)}</div><p>{esc(events[seq]["text"])}</p></blockquote>'
def figure(key,caption):return f'<figure><img src="data:image/png;base64,{figures[key]}" alt="{esc(caption)}" loading="lazy"><figcaption>{esc(caption)}</figcaption></figure>'
def section(id,kicker,title,body):return f'<section id="{id}"><div class="eyebrow">{kicker}</div><h2>{title}</h2>{body}</section>'
def table(headers,rows):return '<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+esc(h)+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+str(v)+'</td>' for v in row)+'</tr>' for row in rows)+'</tbody></table></div>'
parts=[]
parts.append(section('result','01 / OUTCOME','人口活到了征讨日，社会没能走过欠税门槛',f'''
<p class="lead">截至 {clock(D['head']['cutoff'])}，32名初始居民全部死亡，死因均为战斗。王室使者与10名王军仍在场存活。最后死亡的是管家雨果 #3，距王军入境 {duration:.2f} 个游戏日。</p>
{figure('outcome','人口变化按死亡事件精确定位；税额按日边界取值，kg单位。D36和D66分别对应内部结算日35、65。')}
<div class="cards"><article><b>0</b><h3>饥饿死亡</h3><p>本轮未出现早期领主或农民饿死的终局。出兵时仍有32名本地活人，平均记录生命值约99.87。</p></article><article><b>57</b><h3>居民命中王军</h3><p>确有反击。王军完成182次对居民命中；全部32例死亡的最后一击都可追溯到王军。</p></article><article><b>0</b><h3>本地人攻击领主</h3><p>完成的本地对本地攻击为0，国王状态没有叛乱汇报。无法据此认定发生了农民推翻领主的自主起义。</p></article></div>
<p>直接终局是<strong>欠税触发的确定性镇压</strong>。D87派军时，连续欠税为21个结算日，严格超过配置的2×10；领主当时仍活着。居民后来的抵抗是对来袭王军的反击，不能倒推为此前已组织了叛乱。{ref(202126)} {ref(208234)}</p>
'''))
parts.append(section('economy','02 / FOOD & TAX','歉收压缩了余地，但库存不足以证明结局必然',f'''
{figure('stocks','库存区分家庭、庄园、村仓、王税仓、活人随身与田间成熟粮。尸体随身粮与王军补给不计入本地可分配库存。日边界采样会平滑日内搬运波动。')}
{figure('budget','按配置与成熟事件计算产出。需求条为32人满额进食30天加一期王税，是稳态预算，不代表某天必须一次拿出的粮。')}
<p>正常周期潜在产量 {normal:.2f}kg，D31实际全部成熟；第二次潜在产量因歉收降至 {normal*.5:.2f}kg，D61实际成熟 {yields[1]:.2f}kg，兑现约 {yields[1]/(normal*.5)*100:.1f}%。与满额减产收成相比，另少了 {normal*.5-yields[1]:.2f}kg；这比最终欠款 {F['arrears']:.2f}kg略多，但补足耕作仍需及时收割、运输并缴入王税仓，不能直接当作“必能避免出兵”的反事实证明。</p>
<p>32人30天口粮约 {need:.2f}kg，加王税 {tax:.2f}kg，合计 {need+tax:.2f}kg；减产周期单靠当期产出缺口约 {need+tax-yields[1]:.2f}kg。实际世界还有库存结转和胃内能量，因此<strong>长期预算失衡不等于当期立即无法缴税</strong>。</p>
<div class="callout"><strong>D66的库存压力测试</strong><p>全部本地库存、随身粮和已熟待搬粮合计 {available66:.2f}kg。扣掉当时欠税 {m66['arrears']:.2f}kg，再预留到下次收获前25天的32名居民与1名使者口粮，账面约剩 {reserve66:.2f}kg。这个简化测算假定粮食能自由调配、全部及时收割、没有运输损耗；它不提供可执行方案，但说明该阶段仍有非常狭窄的协调空间。</p></div>
<p>D87出兵时，全体本地活人的随身粮还有 {m87['carriedLocal']:.2f}kg，本地各处可分配粮合计约 {available87:.2f}kg；粮食并未全世界耗尽，庄园粮仓却只剩 {m87['keep']:.2f}kg。关键张力在<strong>粮食分散在哪里、谁知道、谁愿意或能够集中调拨</strong>。</p>
'''))
parts.append(section('tax','03 / TAX EXECUTION','首期按期交齐；第二期停在64.94 kg',f'''
{table(['阶段','实际发生','证据'],[
 ['D35 02:17','税收官向王税仓存入330.882kg，提前完成主要备税',ref(80833)],
 ['D36 00:00',f'首期自动扣缴{tax:.2f}kg，欠款为0',ref(83105)],
 ['D66 00:00','第二期只扣到上一期遗留的33.938kg，使者入境',ref(151326)+' '+ref(151327)],
 ['D71 / D73 / D75 / D76','分别自动补扣82 / 35 / 75 / 40kg',ref(163246)+' '+ref(167877)+' '+ref(172573)+' '+ref(174893)],
 ['D76 → D87',f'欠款停在{F["arrears"]:.2f}kg，11天没有新增成功补扣',ref(174893)+' '+ref(202126)]])}
<p>两期合计应缴 {2*tax:.2f}kg，实缴 {F['paid']:.2f}kg，完成率 {F['paid']/(2*tax)*100:.1f}%。本轮不是“完全不交税”。存入王税仓的实粮中，税收官贡献 {payby[2]:.2f}kg、财政官 {payby[32]:.2f}kg，玛拉和领主分别约 {payby[4]:.2f}kg、{payby[1]:.2f}kg。</p>
<p>财政官确实执行了127kg的拨税；后期问题不能概括为他从未做事。使者未自动离场也符合当前规则：他在第二期欠税后才出现，而欠款之后从未归零。没有触发“税收齐了”的条件。</p>
'''))
parts.append(section('cases','04 / DECISION AUDIT','两处可复核的理解偏差，改变了后期协调',f'''
<h3>A. 个人七日口粮，与七人七日口粮混在了一起</h3>
<p>单人每日耗粮约 {R:.3f}kg，所以个人七日口粮应约 {7*R:.2f}kg；36kg则接近<strong>七人</strong>七日口粮。财政官的计划反复把36kg称为自己的“七日线”，还真实执行了 <code>supply amount=36</code>。</p>
{figure('finance','日边界记录：财政官随身库存与庄园粮仓对照。个人七日基准5.15kg，庄园七人七日基准36.03kg。')}
{quote(176917,'D76 21:20 · 将36kg当作个人七日线')}
{quote(178107,'D77 09:25 · 取粮之后停止拨税')}
<p>到D80，他仍称个人33.49kg“几乎到七日限”，据此认为自己也没有余粮可垫。最终其尸体带着27.05kg粮食，约个人36.8日口粮。{ref(185228)} {ref(208110)} 这些证据支持<strong>数值适用对象混淆</strong>，并不证明主观恶意；财政官还受领主“不得动底线”的命令约束。</p>
<h3>B. “13.79kg失踪案”存在完整、不同于指控的交易链</h3>
{table(['事件','实际库存变动','说明'],[
 [ref(164206),'村仓 +13.790kg → 14.124kg','#13 磨坊·母把粮食存入村仓'],
 [ref(164920),'村仓 −3.156kg → 10.969kg','村长 #7 自动领取口粮'],
 [ref(165457),'村仓 −10.969kg → 0','玛拉 #4 取走余粮'],
 [ref(167896),'庄园粮仓 +10.970kg','D73 00:11，玛拉完成存入（数值为原事件的显示精度）']])}
<p>领主、财政官后来反复把这笔粮当成窃取或隐匿事项，甚至追究税收官的取运窗口。账上并没有一笔无法解释的13.79kg消失；村仓兼作村长口粮来源，加上玛拉跨日运输，可以解释这些余额变化。{ref(190117)} {ref(195156)}</p>
<div class="callout"><strong>信息界面缺的是交易因果，模型补上了猜测</strong><p>当前“只能现场看余额＋靠口头/手写账簿”不能稳定证明经手人。两次库存读数之差混有进食、其他人领取和运输，无法直接当成某人的交付差额。报告建议给有权限的人提供仓储交易回执查询，并明确标注“待核实”，而不是授予所有居民全图全知。</p></div>
'''))
parts.append(section('social','05 / COMMUNICATION','有跨家庭交流，也有静默发言与邮件堵塞',f'''
{figure('dialogue','左：实际发言—听众接触矩阵，对数色阶；同一条话被多人听见计多个人次。右：按发言通道分组的无人听见比例。图不等同于信任、共识或合作网络。')}
<p>完成发言 {len(D['speeches']):,} 条，其中 {firstempty} 条没有任何听众，占 {firstempty/len(D['speeches'])*100:.1f}%。这部分文本没有把命令传给其他Agent；其余被听见也不代表接收者同意或执行。</p>
<p>当前共63封信，52封已送达，11封仍由管家持有待审。管家本人寄给庄园成员的新快速信件，日志显示确实在写完后1游戏小时到达；历史上旧的自寄待审信没有被追溯改写。邮件成为另一条沟通通道，但审信仍是一处人为瓶颈。</p>
<h3>破门警报出现了，无法从本轮单独估计它的因果效果</h3>
<p>现有分支记录16次破门声音事件。第一组发生在D79玛拉砸磨坊家的门，覆盖28名听众；王军D87砸门时，一次可覆盖36名听众（含王室人员）。{ref(184215)} {ref(202317)} 此后本地人确有对王军的57次命中，但自动战斗反应同样会产生攻击，不能把这些全部归功于警报或LLM主动决策。</p>
{figure('health','初始32人的记录生命值；死亡精确时刻以叉号标示。大量死亡集中在王军到达后的两天多，之前总体健康。')}
'''))
parts.append(section('engineering','06 / ENGINEERING','算术总账稳定，执行与上下文仍有局部缺陷',f'''
{table(['发现','证据强度','范围与解释'],[
 ['粮食守恒 / 回放连续','已验证',f'209,609条事件无序号缺口；最终Agent回放吻合；日采样最大守恒残差{D["checks"]["maxBalanceResidual"]:.2e}kg。'],
 ['7次上下文溢出','已记录','全部发生在管家#3，集中D78–D80、D84–D85，正值欠税后期；这是明确的工程失败，不是人物主动沉默。'],
 ['137次“目标离开交互距离”','已核对动作','全部是王军攻击结算，目标已移动；不能当成137次运粮失败。王军攻击结算共333次，其中182次命中、151次失败。'],
 ['22次迟到计划被拒绝','保护性行为','版本校验防止旧回复覆盖新任务；另有4次地点/日程ID错误，不能混成格式失败。'],
 ['5次连接错误','短暂故障','集中D10一次批量请求；本轮未因此发生饥饿死亡。'],
 ['余额→经手人推断','认知与可观测性问题','真实交易链存在，角色却用不完整余额与口供归因；不是粮食在数据库里凭空丢失。']])}
<p>共 {D['attempts']['requests']:,} 条模型请求结果，最终错误 {modelerror} 条（{modelerror/D['attempts']['requests']*100:.2f}%）。请求耗时中位数 {statistics.median(lat):.2f}s，P95 {lat[int(.95*(len(lat)-1))]:.2f}s。低总体错误率并不能掩盖关键岗位在危机期间连续失败。{ref(180578)} {ref(199186)}</p>
<h3>下轮优先验证的改进</h3>
<ol class="priorities"><li><strong>把数值对象写在数字旁边。</strong>区分“本人每天/本人七天”“庄园N人每天/七天”；随身粮同时展示能吃几天。针对错误对象计算增加提示，不强制没收个人库存。</li><li><strong>为授权仓储提供可查询的交易回执。</strong>标注经手人、数量、时间、用途，并区分预留/领取/存入/税收扣缴，避免以余额差代替交易记录。</li><li><strong>缩减反复输入的私人信箱与历史。</strong>对已读长邮件提供索引和按需正文；单次观察设置结构预算，对context_overflow单独报警和恢复。压缩旧tail无法解决当前观察自身过大。</li><li><strong>分开统计决定、尝试与命中。</strong>攻击在移动目标上失败属于接触验证结果，未来可测试较短攻击前摇或进入近战范围后的短时跟随；避免把它伪装成成功攻击。</li><li><strong>固定版本再做重复实验。</strong>分别比较“清晰数值”“仓储回执”“固定旧接口”条件，多随机种子；将缴税、饥饿、反抗对象和共识形成分开评价。</li></ol>
'''))
parts.append(section('cost','07 / RUNTIME & STORAGE','缓存命中率已高，回放状态仍占大头',f'''
{figure('runtime','左：每日思考与发言次数；右：最占空间的6类回放事件。这里的次数不是等量劳动或社会贡献。')}
<div class="cards"><article><b>{D['usage']['prompt_tokens']/1e6:.2f}M</b><h3>Agent输入token</h3><p>其中缓存命中 {D['usage']['prompt_cache_hit_tokens']/1e6:.2f}M，未命中 {D['usage']['prompt_cache_miss_tokens']/1e6:.2f}M。</p></article><article><b>{cache*100:.1f}%</b><h3>输入缓存命中比例</h3><p>模型输出 {D['usage']['completion_tokens']/1e6:.2f}M token；包括规划和压缩等尝试汇总，不虚构实际账单价格。</p></article><article><b>{logical/2**20:.1f} MiB</b><h3>本轮内容字段体积</h3><p>MySQL OCTET_LENGTH精确汇总；不含表索引、行开销、独立访谈与磁盘备份。</p></article></div>
<p>回放事件压缩payload约 {sum(D['eventBytes'].values())/2**20:.1f}MiB，占所统计内容 {sum(D['eventBytes'].values())/logical*100:.1f}%。动作开始、休息、身体更新和等待四类占回放payload约 {sum(D['eventBytes'][k] for k in ['action_started','rest','body','idle'])/sum(D['eventBytes'].values())*100:.1f}%。进一步压缩应优先考虑字段级增量、稳定身份信息分离与时间区间记录，同时保留可验证的回放语义。</p>
{table(['表','行数','计入内容 MiB'],[[f'<code>{s["table"]}</code>',f'{s["rows"]:,}',f'{s["bytes"]/2**20:.3f}'] for s in sorted(D['storage'],key=lambda s:-s['bytes'])])}
'''))
# Interactive evidence and actor roster
parts.append(section('evidence','08 / EVIDENCE EXPLORER','查阅原始事件与个体结局',f'''
<p>点击报告里的事件编号可定位下方原文。也可按人物、日期与关键字筛选；一次显示60条，避免把数千条记录同时绘制到页面。</p>
<div class="filters"><input id="search" placeholder="关键字、事件编号，例如 七日线 / 176917" aria-label="搜索事件"><select id="actor" aria-label="人物"><option value="">全部人物</option>{''.join(f'<option value="{a}">#{a} {esc(v["name"])}</option>' for a,v in roster.items())}</select><label>从D<input id="from" type="number" min="1" max="91" value="1"></label><label>至D<input id="to" type="number" min="1" max="91" value="90"></label></div>
<div class="results"><span id="count"></span><button id="prev">上一页</button><button id="next">下一页</button></div><div class="table-wrap"><table class="evidence"><thead><tr><th>事件 / 时间</th><th>人物 / 类型</th><th>记录原文</th></tr></thead><tbody id="rows"></tbody></table></div>
<details><summary>32名本地居民的死亡记录</summary>{table(['人物','死亡时刻','死因 / 事件','随身粮 kg'],[[f'#{d["id"]} {esc(d["name"])}',clock(d['time']),ref(d['seq'])+' 战斗',f'{d["grain"]:.2f}'] for d in D['deaths']])}</details>
'''))
parts.append(section('method','09 / METHODS','快照边界、口径与结论的限度',f'''
<ul><li>实验：<code>{D['run']}</code>；提取时间 {esc(D['extracted'])}。分析截止 {clock(D['head']['cutoff'])}，事件 E{D['head']['seq']}，状态为暂停；计划长度150天，本报告不是完整150天结果。</li><li>MySQL只读一致性快照；使用初始快照逐事件回放，按实际actor/listeners统计交流和行为。正文中“实际”指已结算事件，“计划”仅指Agent输出或接受的任务。</li><li>粮食总账：初始与外部新增供给＋累计成熟−累计食用−上缴王室−全部仓储−所有人物随身（含尸体、王室和离场者）−田间成熟余粮。主体分析将外来王室与本地居民分开。</li><li>第31天进行过一次回滚与上下文重建 {ref(68307)}，导航、门禁、使者、邮件和破门感知在运行期间存在升级。保存的数据是当前分支，已删除的旧未来不计入；不能把本轮视为固定实现下的单一受控实验。</li><li>每30个内部游戏日成熟一次；UI日期为floor(time/DAY)+1，因此内部第35日扣税显示为D36，设置shockDay=40显示为D41开始、下一次成熟D61才兑现减产。</li><li>健康图使用持久状态日采样，截止日是不完整的一天；图中的连线不表示所有日内交易连续变化。成本为记录的token使用量，未估算价格。新闻是二次总结，没有作为事实判定依据。</li><li>“没有本地人攻击领主”限定于本分支已完成攻击事件；它不能排除未执行的意图、反抗谈论或其他政治表达。单轮观察也不能证明某项提示词或警报造成了某种社会行为。</li></ul>
<p class="small">附件：<a href="data.json">本报告提取数据（JSON）</a> · <a href="../../scripts/reports/extract_latest.py">提取脚本</a> · <a href="../../scripts/reports/render_latest.py">Python制图与报告脚本</a>。图像和事件浏览数据均嵌入HTML，报告本身可离线单文件阅读；附件链接需要保留目录结构。</p>
'''))
css='''*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:76px}body{margin:0;background:#f2f3ed;color:#223743;font:16px/1.85 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:#236b65;text-decoration:none}button,input,select{font:inherit}button{cursor:pointer}nav{position:sticky;top:0;z-index:10;background:#f2f3edf5;border-bottom:1px solid #d7dfd8;backdrop-filter:blur(12px)}.nav-inner{max-width:1200px;margin:auto;display:flex;gap:25px;padding:13px 32px;overflow:auto;white-space:nowrap;font-size:13px}nav .brand{font-weight:800;color:#203846;margin-right:auto}.hero{background:#193342;color:#fff;padding:72px max(32px,calc((100vw - 1120px)/2)) 44px;position:relative;overflow:hidden}.hero:after{content:"";position:absolute;width:360px;height:360px;border:1px solid #ffffff20;border-radius:50%;right:-120px;top:-130px;box-shadow:0 0 0 55px #ffffff04,0 0 0 110px #ffffff03;pointer-events:none}.eyebrow{font:700 11px/1.5 ui-monospace,monospace;letter-spacing:2px;color:#5c8179;text-transform:uppercase;margin-bottom:12px}.hero .eyebrow{color:#a8c9ba}.hero h1{font-size:clamp(32px,4.4vw,57px);line-height:1.23;letter-spacing:-1px;font-weight:730;margin:20px 0}.hero h1 em{font-style:normal;color:#eaba6c}.hero p{color:#c8d5d7;max-width:760px;font-size:17px}.hero .stamp{font:12px ui-monospace,monospace;color:#a6c0c2;margin-top:28px}.hero-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:25px;margin-top:42px;border-top:1px solid #ffffff26;padding-top:23px}.hero-metrics b{display:block;font-size:29px;line-height:1.4}.hero-metrics span{font-size:12px;color:#abc4c6}main{max-width:1184px;margin:auto;padding:0 32px 70px}section{padding:48px 0 14px;border-bottom:1px solid #d9dfd8}h2{font-size:29px;line-height:1.4;letter-spacing:-.4px;margin:0 0 20px}h3{font-size:19px;margin-top:24px}p{margin:12px 0 20px}.lead{font-size:19px;color:#395665}strong{font-weight:700;color:#133d42}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:17px;margin:25px 0}.cards article{padding:22px;background:#fcfcf8;border:1px solid #dae1d9;border-radius:9px}.cards b{font-size:34px;color:#22675c;font-weight:750;line-height:1.3}.cards h3{font-size:15px;margin:6px 0 10px}.cards p{font-size:13px;color:#667982;line-height:1.7;margin:0}figure{background:#fcfcf8;border:1px solid #dde3dc;border-radius:10px;overflow:hidden;margin:23px 0;padding:12px}figure img{display:block;width:100%;height:auto}figcaption{color:#77868c;font-size:12px;line-height:1.7;padding:9px 13px 3px}.callout{background:#e6eee5;border-left:4px solid #357965;padding:20px 25px;border-radius:0 8px 8px 0;margin:24px 0}.callout p{margin:6px 0 0;font-size:15px}blockquote{margin:22px 0;background:#f9f6ed;border:1px solid #e2dac8;border-left:4px solid #d19a4b;padding:18px 24px;border-radius:0 8px 8px 0}blockquote div{font-size:12px;color:#9a743f;font-weight:700}blockquote p{font-size:14px;line-height:1.9;margin:10px 0 0}.table-wrap{overflow:auto;border:1px solid #dce3dc;border-radius:8px;background:#fcfcf8;margin:20px 0}table{border-collapse:collapse;width:100%;text-align:left;font-size:14px}th{background:#e9eee7;font-size:12px;color:#55716b;white-space:nowrap}th,td{padding:13px 16px;border-bottom:1px solid #e7ebe4;vertical-align:top}tbody tr:last-child td{border:0}code{font:12px/1.6 ui-monospace,monospace;overflow-wrap:anywhere;background:#e9eee7;padding:2px 4px;border-radius:3px}.ref{display:inline-block;background:#e5ede5;border:0;border-radius:4px;padding:2px 7px;color:#266b5e;font:11px/1.8 ui-monospace,monospace;margin:2px}.ref:hover{background:#bcd6c7}.priorities li{padding:8px 0}li{margin:9px 0}.filters{display:flex;gap:10px;flex-wrap:wrap;background:#e6ece5;padding:15px;border-radius:8px}.filters input,.filters select{background:#fcfcf8;border:1px solid #c9d6ce;border-radius:5px;padding:8px 10px;font-size:13px}.filters input#search{flex:1;min-width:230px}.filters label{font-size:12px;display:flex;align-items:center;gap:5px}.filters input[type=number]{width:67px}.results{display:flex;gap:10px;align-items:center;margin-top:13px;font-size:12px}.results span{margin-right:auto}.results button{background:#fff;border:1px solid #c8d6cc;padding:4px 12px;border-radius:4px;color:#2d655b}.evidence td{font-size:12px}.evidence td:nth-child(1){min-width:130px}.evidence td:nth-child(2){min-width:130px}.evidence td:nth-child(3){min-width:300px;white-space:pre-wrap;word-break:break-word}.evidence tr.focus{background:#fff2cc}.small{font-size:12px;color:#7a898d}details{margin:24px 0}summary{cursor:pointer;color:#28695e;font-weight:700}footer{padding:35px;text-align:center;color:#6b7a82;font-size:12px;background:#e7ece6}@media(max-width:720px){.hero{padding:40px 22px}.hero-metrics{grid-template-columns:repeat(2,1fr)}main{padding:0 18px 35px}.nav-inner{padding:12px 18px;gap:18px}.cards{grid-template-columns:1fr}.cards article{padding:18px}.cards b{font-size:28px}h2{font-size:24px}section{padding-top:34px}th,td{padding:10px}blockquote{padding:16px}figure{padding:3px}.hero h1{font-size:34px}}@media print{nav,.filters,.results,#evidence .table-wrap,button.ref{display:none}.hero{background:#193342!important;print-color-adjust:exact}main{max-width:none;padding:0}section{break-before:auto}figure,.cards,blockquote{break-inside:avoid}body{font-size:12px}h2{font-size:23px}}'''
js='''const DATA=JSON.parse(document.getElementById('dataset').textContent);const names=JSON.parse(document.getElementById('names').textContent);let page=0,focus=null;const $=id=>document.getElementById(id);function render(){const key=$('search').value.trim().toLowerCase();const who=$('actor').value;const lo=Number($('from').value)||1,hi=(Number($('to').value)||90)+1;const rows=DATA.filter(e=>(!who||String(e.actor)===who)&&e.d>=lo&&e.d<hi&&(!key||(String(e.seq)+' '+e.text+' '+e.kind).toLowerCase().includes(key)));page=Math.max(0,Math.min(page,Math.ceil(rows.length/60)-1));$('count').textContent=`共 ${rows.length.toLocaleString()} 条 · 第 ${page+1} / ${Math.max(1,Math.ceil(rows.length/60))} 页`;$('rows').replaceChildren();for(const e of rows.slice(page*60,page*60+60)){const tr=document.createElement('tr');if(e.seq===focus)tr.className='focus';for(const text of [`E${e.seq} · ${e.clock}`,e.actor?`#${e.actor} ${names[e.actor]||''}\n${e.kind}`:`世界\n${e.kind}`,e.text]){const td=document.createElement('td');td.textContent=text;tr.append(td)}$('rows').append(tr)}$('prev').disabled=page===0;$('next').disabled=(page+1)*60>=rows.length}for(const id of ['search','actor','from','to'])$(id).addEventListener('input',()=>{page=0;focus=null;render()});$('prev').onclick=()=>{page--;render()};$('next').onclick=()=>{page++;render()};document.querySelectorAll('[data-evidence]').forEach(b=>b.onclick=()=>{focus=Number(b.dataset.evidence);$('search').value=String(focus);$('actor').value='';$('from').value=1;$('to').value=90;page=0;render();document.getElementById('evidence').scrollIntoView({behavior:'smooth'})});render();'''
nav=''.join(f'<a href="#{i}">{label}</a>' for i,label in [('result','终局'),('economy','粮食'),('cases','决策偏差'),('social','沟通'),('engineering','工程'),('evidence','证据')])
report=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>鸦溪领地实验报告 · D90 · 最新分支</title><style>{css}</style></head><body><nav><div class="nav-inner"><span class="brand">RAVENBROOK / FIELD NOTES</span>{nav}</div></nav><header class="hero"><div class="eyebrow">EXPERIMENT AUDIT · 2026 / 09 / 12</div><h1>一笔 <em>{F['arrears']:.2f} kg</em> 的欠税<br>与 32 人的终局</h1><p>首次王税按期缴清，第二次在歉收与协调失误中停滞。<br>一份基于真实交易、对话与决策轨迹的连续村庄实验报告。</p><div class="stamp">{D['run']}<br>{clock(D['head']['cutoff'])} · E{D['head']['seq']} · READ-ONLY SNAPSHOT</div><div class="hero-metrics"><div><b>32 / 32</b><span>本地居民战斗死亡</span></div><div><b>{F['paid']/(2*tax)*100:.1f}%</b><span>两期王税实缴比例</span></div><div><b>{duration:.2f} 天</b><span>出兵至最后居民死亡</span></div><div><b>{D['checks']['events']:,}</b><span>已核对回放事件</span></div></div></header><main>{''.join(parts)}</main><footer>Agent World Sim · 实验记录与推断分开呈现 · 图表由 Python / Matplotlib 生成</footer><script type="application/json" id="dataset">{json.dumps(sorted(events.values(),key=lambda e:e['seq']),ensure_ascii=False,separators=(',',':')).replace('</','<\\/')}</script><script type="application/json" id="names">{json.dumps({a:v['name'] for a,v in roster.items()},ensure_ascii=False)}</script><script>{js}</script></body></html>'''
(OUT/'report.html').write_text(report)
(OUT/'summary.json').write_text(json.dumps({'cutoff':clock(D['head']['cutoff']),'logicalMiB':logical/2**20,'reserveStressD66':reserve66,'cacheRate':cache,'duration':duration,'evidenceRows':len(events),'figures':list(figures)},ensure_ascii=False,indent=2))
print(json.dumps({'html':str(OUT/'report.html'),'bytes':len(report.encode()),'figures':len(figures),'evidenceRows':len(events),'reserve66':reserve66},ensure_ascii=False))
