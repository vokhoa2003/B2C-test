II. Luồng test search và tạo đơn nâng cao cho vé máy bay, ko cần đến bước thanh toán:
Hãy build một file json đa điều kiện, nếu có thì truyền, nếu ko có thì skip điều kiện đó cho việc search chuyến bay
        1. Mô tả tập điều kiện:
số lượng người: người lớn (ngẫu nhiên trong khoảng 1-4), trẻ em (ngẫu nhiên trong 0-3), em bé (ngẫu nhiên trong 0-2, lưu ý: số em bé <= số người lớn)
Hành trình: khứ hồi, 1 chiều. Đặc biệt có case:
        --Khứ hồi cùng hãng bay.
        --Khứ hồi khác hãng bay.
Ngày tháng đi/về: ngày tháng cách ngày hiện tại tối thiểu 20 ngày, random ngày tháng
Hạng ghế: ngẫu nhiên chọn 1 trong những hạng ghê được hỗ trợ trên chuyến bay.
Giờ bay: ngẫu nhiên chọn 1 giờ bay.
Chặng có điểm dừng: ngẫu nhiên chọn chặng có điểm dày hoặc bay thẳng.
Điểm đi/điểm đến: ngẫu nhiên chọn 1 hành trình được định nghĩa khi nhận điều kiện kích hoạt test
Hãng bay: mặc định phải đợi load xong tất cả hãng bay, có option chỉ định chọn 1 hãng duy nhất cho tất cả các lần test (mặc định ngẫu nhiên trong tất cả dữ liệu trả ra)

        2. Yêu cầu: 2 luồng là search lưu thông tin, và search để tạo order (2 case test báo cáo khác nhau)
                a. Spec search lấy thông tin (2 giai đoạn):
                        Giai đoạn 1: Search lưu trữ thông tin list
Mỗi một điều kiện đều có thể setup cờ để focus vào, ví dụ:
        --Chuyến đi chỉ có người lớn, chuyến đi chỉ có người lớn và trẻ em,... mặc định ngẫu nhiên
        --Hãng bay: VNA, VJ => chỉ tìm trong 2 hãng này ngẫu nhiên luân phiên. Không có hãng kia thì mặc định lấy hãng còn lại trong tất cả testing, kéo xuống để load đủ
        --Hãng bay: VJ, VNA, Adt, inf, international: search chuyến đi quốc tế cho người lớn và em bé, chỉ chọn 2 hãng là vna hoặc vj
        --.....
Về hãng bay: mặc định là test không trùng, tối đa 5 lần search/order. Lưu lại thao tác để khi chạy lần 2 sẽ tiếp tục search 5 hãng mới tiếp theo. Trường hợp không có hãng nào khác thì lặp lại các hãng cũ ngẫu nhiên sao cho ưu tiên các bộ điều kiện không trùng.
Về báo cáo, tôi muốn bạn tạo file để giữ báo cáo theo các case đã test, note. Ví dụ
        --Id case 1: search với điều kiện .....:
                        Kết quả:
                                --Có n Chuyến hãng VNA:
                                        Có n chuyến 1 chiều:
                                                Máy bay VN110 HAN đi SGN từ [giờ đi] -> [giờ đến]
                                                        Hạng eco:
                                                                người lớn: [giá gốc] -> [giá bán]
                                                                trẻ em:....
                                                        Hạng bussiness: giá 
                                                        Hạng....
                                        Có n chuyến bay thẳng:
Lưu ý về hạng, mỗi một hãng sẽ có một cách định nghĩa hạng khác nhau, nên chuẩn nhất là chọn trên FE
Điều kiện sẽ cố gắng set up một điều kiện đa dạng nhất để search cho nhiều hãng
                        Giai đoạn 2: search chi tiết dịch vụ trên mỗi hãng:
Yêu cầu: 
--chọn không trùng mỗi hãng trên list trả ra để đi vào phần "Đặt ngay"
--Khi vào sẽ có các dịch vụ bao gồm:
        --Hành lý: nếu nhiều người có thể ngầu nhiên chọn hết hoặc chỉ vài người chọn | nếu khứ hồi, có thể tùy chọn người A có hành lý chiều đi nhưng ko chiều về hoặc chọn cả 2, tương tự ngẫu nhiên chọn hoặc ko chọn
        --Chọn trước chỗ ngồi: tương tự như hành lý
        --Check-in online: chỉ 1 lần chọn là đủ

Dữ liệu cần ghi lại
Cần ghi lại giá vé, giá thuế, giá dịch vụ, giá tổng. Ví dụ 2 người lớn 1 trẻ em:
Chiều đi:
Người A giá vé ... thuế và phí... chỗ ngồi... hành lý ký gửi.... 
Người B giá vé ... thuế và phí...
Trẻ em giá vé ... thuế và phí... chỗ ngồi... 
Chiều về: (tương tự)
-
=
-
Giảm giá...
Tổng giá vé 
Giá gốc: [Giá gốc nếu có]
Tổng giá đã bao gồm thuế, phí, VAT [giá màu đỏ]

--------------------------------
Lưu ý: 
--Đến bước này chỉ là bước điền thông tin, khi chuyển sang tạo orderm, tức là "Tiếp tục đến bước thanh toán" sẽ còn đổi giá một làn nữa
--Test này sẽ chỉ đến bước ở giai đoạn 2 là cuối cùng
--Lưu thông tin báo cáo test nếu được ở dạng mà tôi có thể import vào excel
--Có thể có thông báo "Thời gian thanh toán đã hết hạn" -> button "Cập nhập giá vé" ko phải lỗi, nó sẽ trả ra trang list với các điều kiện ban đầu search
--Lưu ý, hành lý/chỗ ngồi có thể chọn được, có thể không tùy hãng
--------------------------------
Kế hoạch:
--Hãy build testsatck xử lý được các yêu cầu trên, sau đó thử với các case dưới đây
--Đầu tiên test happy case với tất cả điều kiện đều được chọn:
        --1 adt, 1 chd, 1 inf, chuyến 1 chiều nội địa. Chọn tất cả option hành lý, chỗ ngồi nếu có cho tất cả
        --1 adt, 1 chd, 1 inf, chuyến khứ hồi nội địa. Chọn tất cả option hành lý, chỗ ngồi nếu có cho tất cả
        --2 adt. 1 chd, 1 inf, chuyến khứ hồi nội địa. Chọn tất cả option hành lý, chỗ ngồi nếu có cho tất cả
        --1 adt, 1 chd, 1 inf, chuyến khứ hồi trong nước -> nước ngoài. Chọn tất cả option hành lý, chỗ ngồi nếu có cho tất cả

-------------------------------------------------------------------------------------------------------------------------
I. Luồng test search và tạo đơn cơ bản cho vé máy bay (thời gian search xa ngày hiện tại tầm 20 ngày):
    1. Mục tiêu cấn tracking:
        a. Tracking search:
-Ghi lại được loại hành trình: quốc tế, nội địa. Quốc tế chính là bất kỳ chặng nào có điểm đi/điểm đến/hoặc cả 2 có nước ngoài, nội địa là chỉ ở Việt Nam.
-Ghi lại hành trình được search. Ví dụ SGN -> HAN 1 chiều, SGN -> HAN | HAN -> SGN khứ hồi.
-Ghi lại được số người lớn (adt), số trẻ em (chd), số em bé (inf)
-Ghi lại số hãng bay được search ra: ví dụ như VNA, VJ, VU,...
-Ghi lại được số chuyến bay/giờ bay được trả ra theo hãng. 
-Ghi lại được số tiền của từng chặng theo từng hạng vé.

Ví dụ 1: search chuyến đi HAN -> SGN cho 1 người lớn, kết quả mong muốn có thể là:
Chuyến VNA mã máy bay VN002 khởi hành lúc ... có giá ... cho hạng ..., giá ... cho hạng...
Chuyến VNA mã máy bay VN003 khởi hành lúc ... có giá...(gốc, giá gạch ngang nếu có) giảm còn ...(giá màu đỏ) ... cho hạng ..., giá ... cho hạng...
Chuyến _9G mã máy bay 9G113 khởi hành lúc... có giá ... cho hạng

Ví dụ 2: search chuyến khứ hồi SGN -> HAN | HAN -> SGN cho người lớn và trẻ em:
Chuyến VNA mã máy bay VN002 khởi hành từ SGN -> HAN thời gian... lúc ... có giá ... cho hạng ..., giá ... cho hạng...
Chuyến VNA mã máy bay VN002 khởi hành từ HAN -> SGN thời gian... lúc ... có giá ... cho hạng ..., giá ... cho hạng...

        b. Tracking order:
Luồng này sẽ follow theo luồng search ở trên. Khi search 1 chuyến sẽ book và tạo order tương ứng, ko chọn thêm các field không bắt buộc. Mong muốn ghi lại thông tin:
-Số người lơn | trẻ em | em bé
-Loại hành trình, hành trình
-Chuyến bay được chọn
-Giá chi tiết từng phần: Ví dụ giá vé, thuế, giảm giá, phí
-Có tạo đơn hàng thành công hay không.

-----------------------------------------------------
Sau khi thành công thử thanh toán
Thông tin thanh toán sử dụng data test của onepay, thông tin:
Thẻ nội địa
DOMESTIC
Vietcombank
Card number: 9704360000000000002
Card Name: NGUYEN VAN A       
Issue date: 01-13             
OTP: 123456

-------------------------------------------------------
Thông tin đơn hàng
Tên khách hàng 1
SYSTEM AUTO TESTER VIETNAMESE
sdT: 0935912495 - vietname
ngày sinh:auto
CMND/CCCD/Hộ chiếu: auto
ngày hết hạn: auto
--
Tên khách hàng 2
SYSTEM AUTO TESTER ABROAD
sdT: số tương ứng - nước bất kỳ
ngày sinh:auto
CMND/CCCD/Hộ chiếu: auto
ngày hết hạn: auto

--

Thông tin liên hệ
Ho ten: VO PHAM DANG KHOA
email random 1 trong 2: vophamdangkhoa.010103@gmail.com hoặc akiyoshimeo@gmail.com
số điện thoại: 0935912495

--

Yêu cầu ở test case simple:
Tạo tối đa 3 order dù thành công hay thất bại, tương ứng vs order được tạo thanh toán dù thành công hay thất bại cho mỗi lần run test
Chặng có thể đổi qua lại giữa các thông tin sau: SGN, HAN, TPE, DAD, SYD, NRT. Các chặng có liên quan quốc tế đặt xa hơn 40 ngày
Thời gian đợi phản hồi sẽ tăng lên 30s
ngày search tối thiểu cách xa 20 ngày so với hiện tại
Lưu trữ lại điều kiện test để tránh trùng lặp, điều kiện fail note riêng để tùy ý rerun. 
Không cần đăng nhập tài khoản khách hàng để tạo order.
Không được search book cùng lúc 3 order mà làm xong 1 cái (dù fail hay success) mới được làm cái tiếp theo


Các case không tính là lỗi, trạng thái sẽ là WAITING_RECHECK (hoặc tên gì đó hợp lý hơn, trạng thái này có thể trùng):
search ko có chuyến nào được trả ra -> lưu lại chuyến này -> search chuyến khác để tạo order
